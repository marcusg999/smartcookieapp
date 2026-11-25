import "server-only";

import type Stripe from "stripe";

import { env } from "@/lib/env";
import { previousMonth } from "@/lib/school/billing";
import { stripe, stripeMockMode } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInZone } from "@/lib/time";

type Admin = ReturnType<typeof createAdminClient>;
type Db = { rpc: Admin["rpc"] };

/**
 * Phase 7: monthly school invoices through Stripe Invoicing.
 *
 * The database decides WHAT is billed (prepare_school_invoice gathers the
 * uninvoiced lines, grouped by classroom × week, and locks them to a draft
 * invoice). This module turns a draft into a Stripe Invoice: send_invoice
 * collection, Net terms from the school's billing terms, card + ACH bank
 * transfer, tax-exempt when flagged. Every Stripe call has an idempotency key
 * tied to our row ids, so a retry after a crash finishes the same invoice.
 */

/** Prepare (or resume) and issue one school's invoice. Returns the invoice id, or null if there was nothing to bill. */
export async function createSchoolInvoice(
  db: Db,
  orgId: string,
  kind: "monthly" | "on_demand",
  period: { start: string; end: string },
): Promise<string | null> {
  const { data: id, error } = await db.rpc("prepare_school_invoice", {
    p_org: orgId,
    p_period_start: period.start,
    p_period_end: period.end,
    p_kind: kind,
  });
  if (error) throw error;
  if (!id) return null;
  await issueSchoolInvoice(id as string);
  return id as string;
}

/** Turn a draft invoice into a finalized Stripe Invoice and email the school. */
export async function issueSchoolInvoice(invoiceId: string): Promise<void> {
  // Service role: issuing runs from the monthly job and from admin actions
  // that were already authorized (ops/owner, AAL2). It reads the school's
  // billing details and writes Stripe ids, which no user role can write.
  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select(
      "id, organization_id, status, kind, period_start, period_end, total_cents, tax_cents, currency, stripe_invoice_id, organizations ( id, name, billing_email, billing_terms_days, tax_exempt, stripe_customer_id, address )",
    )
    .eq("id", invoiceId)
    .single();
  if (!inv || inv.status !== "draft") return;
  const org = inv.organizations as unknown as {
    id: string;
    name: string;
    billing_email: string | null;
    billing_terms_days: number;
    tax_exempt: boolean;
    stripe_customer_id: string | null;
    address: { line1?: string; city?: string; state?: string; zip?: string } | null;
  };
  const { data: lines } = await admin
    .from("invoice_lines")
    .select("id, description, amount_cents, stripe_invoice_item_id")
    .eq("invoice_id", invoiceId)
    .order("sort_order");

  if (!org.billing_email) {
    await admin.from("invoices").update({ last_error: "The school has no billing email yet." }).eq("id", invoiceId);
    throw new Error("missing billing email");
  }

  if (stripeMockMode()) {
    // CI / placeholder keys: play Stripe's part through the same bookkeeping
    // function the webhook uses.
    const due = new Date(Date.now() + org.billing_terms_days * 86_400_000).toISOString().slice(0, 10);
    await admin
      .from("invoices")
      .update({ stripe_invoice_id: `in_mock_${invoiceId.slice(0, 8)}` })
      .eq("id", invoiceId);
    await mustRpc(admin, "stripe_school_invoice_event", {
      p_stripe_invoice: `in_mock_${invoiceId.slice(0, 8)}`,
      p_invoice: invoiceId,
      p_event: "finalized",
      p_amount_paid: null,
      p_hosted: new URL("/school/billing", env.NEXT_PUBLIC_SITE_URL).toString(),
      p_pdf: null,
      p_number: `MOCK-${invoiceId.slice(0, 6).toUpperCase()}`,
      p_due: due,
    });
    await queueInvoiceEmail(admin, invoiceId, org.billing_email);
    return;
  }

  const s = stripe();
  const { data: settings } = await admin.from("site_settings").select("tax_settings, timezone").eq("id", true).single();
  const tax = (settings?.tax_settings ?? {}) as { enabled?: boolean; use_stripe_tax?: boolean };
  const stripeTax = Boolean(tax.enabled && tax.use_stripe_tax);

  // 1) Customer per school (re-used; details kept in sync).
  let customerId = org.stripe_customer_id;
  const details = {
    name: org.name,
    email: org.billing_email,
    tax_exempt: (org.tax_exempt ? "exempt" : "none") as Stripe.CustomerCreateParams.TaxExempt,
    address: org.address?.line1
      ? {
          line1: org.address.line1,
          city: org.address.city,
          state: org.address.state,
          postal_code: org.address.zip,
          country: "US",
        }
      : undefined,
  };
  if (customerId) {
    await s.customers.update(customerId, details);
  } else {
    const customer = await s.customers.create(
      { ...details, metadata: { organization_id: org.id } },
      { idempotencyKey: `customer:org:${org.id}` },
    );
    customerId = customer.id;
    await admin.from("organizations").update({ stripe_customer_id: customerId }).eq("id", org.id);
  }

  // 2) The invoice itself (draft until every line is on it).
  let stripeInvoice: Stripe.Invoice;
  if (inv.stripe_invoice_id) {
    stripeInvoice = await s.invoices.retrieve(inv.stripe_invoice_id);
  } else {
    stripeInvoice = await s.invoices.create(
      {
        customer: customerId,
        collection_method: "send_invoice",
        days_until_due: org.billing_terms_days,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: `Smart Cookie school meals, ${inv.period_start} to ${inv.period_end}`,
        payment_settings: { payment_method_types: ["card", "us_bank_account"] },
        automatic_tax: { enabled: stripeTax && !org.tax_exempt },
        metadata: { invoice_id: invoiceId, organization_id: org.id },
      },
      { idempotencyKey: `school-invoice:${invoiceId}` },
    );
    await admin.from("invoices").update({ stripe_invoice_id: stripeInvoice.id }).eq("id", invoiceId);
  }

  // 3) One item per classroom × week line (plus our flat-rate tax line, if any).
  if (stripeInvoice.status === "draft") {
    for (const line of lines ?? []) {
      if (line.stripe_invoice_item_id || line.amount_cents <= 0) continue;
      const item = await s.invoiceItems.create(
        {
          customer: customerId,
          invoice: stripeInvoice.id,
          amount: line.amount_cents,
          currency: inv.currency as string,
          description: line.description as string,
          metadata: { invoice_line_id: line.id as string },
        },
        { idempotencyKey: `school-invoice-line:${line.id}` },
      );
      await admin.from("invoice_lines").update({ stripe_invoice_item_id: item.id }).eq("id", line.id);
    }
    stripeInvoice = await s.invoices.finalizeInvoice(
      stripeInvoice.id!,
      {},
      { idempotencyKey: `school-invoice-finalize:${invoiceId}` },
    );
  }

  if (!stripeTax && stripeInvoice.total !== inv.total_cents) {
    console.error("school invoice total mismatch", { invoiceId, ours: inv.total_cents, stripe: stripeInvoice.total });
  }
  await mustRpc(admin, "stripe_school_invoice_event", {
    p_stripe_invoice: stripeInvoice.id,
    p_invoice: invoiceId,
    p_event: "finalized",
    p_amount_paid: null,
    p_hosted: stripeInvoice.hosted_invoice_url ?? null,
    p_pdf: stripeInvoice.invoice_pdf ?? null,
    p_number: stripeInvoice.number ?? null,
    p_due: stripeInvoice.due_date
      ? todayInZone((settings?.timezone as string) ?? "America/Los_Angeles", new Date(stripeInvoice.due_date * 1000))
      : null,
  });
  await queueInvoiceEmail(admin, invoiceId, org.billing_email);
}

/**
 * The monthly job: on (or after) the owner's invoice day, bill last month for
 * every school with uninvoiced meals, and finish any draft left by a failed
 * run. Idempotent: a school gets one monthly invoice per month.
 */
export async function runMonthlyInvoicing(now = new Date()): Promise<{ issued: number; failed: number }> {
  // Service role: a scheduled job with no user session, billing every school.
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("site_settings")
    .select("timezone, school_invoice_day")
    .eq("id", true)
    .single();
  const today = todayInZone((settings?.timezone as string) ?? "America/Los_Angeles", now);
  const dueToday = Number(today.slice(8, 10)) >= ((settings?.school_invoice_day as number) ?? 1);
  let issued = 0;
  let failed = 0;

  // Drafts that never reached Stripe (any day).
  const { data: drafts } = await admin.from("invoices").select("id").eq("status", "draft");
  for (const d of drafts ?? []) {
    try {
      await issueSchoolInvoice(d.id as string);
      issued++;
    } catch (error) {
      failed++;
      console.error("resuming school invoice failed", { invoice: d.id, message: (error as Error).message });
    }
  }
  if (!dueToday) return { issued, failed };

  const period = previousMonth(today);
  const { data: orgs } = await admin.rpc("schools_to_invoice", { p_period_end: period.end });
  for (const orgId of (orgs ?? []) as string[]) {
    try {
      if (await createSchoolInvoice(admin, orgId, "monthly", period)) issued++;
    } catch (error) {
      failed++;
      console.error("monthly school invoice failed", { organization: orgId, message: (error as Error).message });
    }
  }
  return { issued, failed };
}

/** Check / PO: mark the Stripe invoice paid out of band (the DB row is updated by the caller's RPC). */
export async function payInvoiceOutOfBand(stripeInvoiceId: string | null, invoiceId: string): Promise<void> {
  if (!stripeInvoiceId || stripeMockMode() || stripeInvoiceId.startsWith("in_mock_")) return;
  const inv = await stripe().invoices.retrieve(stripeInvoiceId);
  if (inv.status === "open" || inv.status === "uncollectible") {
    await stripe().invoices.pay(
      stripeInvoiceId,
      { paid_out_of_band: true },
      { idempotencyKey: `school-invoice-oob:${invoiceId}` },
    );
  }
}

async function queueInvoiceEmail(admin: Admin, invoiceId: string, to: string) {
  const { data: existing } = await admin
    .from("notifications_log")
    .select("id")
    .eq("template_key", "school_invoice")
    .contains("payload", { invoice_id: invoiceId })
    .limit(1);
  if (existing?.length) return;
  const { data: inv } = await admin.from("invoices").select("organization_id").eq("id", invoiceId).single();
  await admin.from("notifications_log").insert({
    to_address: to,
    template_key: "school_invoice",
    status: "queued",
    organization_id: inv?.organization_id ?? null,
    payload: { invoice_id: invoiceId },
  });
}

async function mustRpc(admin: Admin, fn: string, args: Record<string, unknown>) {
  const { error } = await admin.rpc(fn, args);
  if (error) throw new Error(error.message);
}
