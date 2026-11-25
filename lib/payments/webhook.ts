import "server-only";

import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** What the handler may need beyond the database (Stripe calls), injectable for tests. */
export type WebhookDeps = {
  admin: Admin;
  /** Refund a payment in full (used when an expired order gets paid late). */
  refundInFull: (orderId: string, reason: string) => Promise<void>;
};

const SUB_STATUS = new Set([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

const ts = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

function must(res: { error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message);
}

/** Subscription id + our row id from an invoice (current API: invoice.parent.subscription_details). */
function invoiceSubscription(invoice: Stripe.Invoice) {
  const details = invoice.parent?.subscription_details ?? null;
  const stripeSub =
    typeof details?.subscription === "string" ? details.subscription : (details?.subscription?.id ?? null);
  const ours = details?.metadata?.subscription_id ?? null;
  const line = invoice.lines?.data?.[0];
  return { stripeSub, ours, periodStart: ts(line?.period?.start), periodEnd: ts(line?.period?.end) };
}

async function queueOrderConfirmation(admin: Admin, orderId: string) {
  const { data: o } = await admin.from("orders").select("household_id").eq("id", orderId).single();
  if (!o?.household_id) return;
  const { data: hh } = await admin.from("households").select("primary_user_id").eq("id", o.household_id).single();
  const { data: user } = hh?.primary_user_id ? await admin.auth.admin.getUserById(hh.primary_user_id) : { data: null };
  if (!user?.user?.email) return;
  // One confirmation per order, however many times Stripe retries.
  const { data: existing } = await admin
    .from("notifications_log")
    .select("id")
    .eq("template_key", "order_confirmation")
    .contains("payload", { order_id: orderId })
    .limit(1);
  if (existing?.length) return;
  await admin.from("notifications_log").insert({
    to_address: user.user.email,
    template_key: "order_confirmation",
    status: "queued",
    household_id: o.household_id,
    payload: { order_id: orderId },
  });
}

/** School invoice bookkeeping (Phase 7). Out-of-order safe in SQL. */
async function schoolInvoiceEvent(admin: Admin, invoice: Stripe.Invoice, kind: string): Promise<string> {
  const { data, error } = await admin.rpc("stripe_school_invoice_event", {
    p_stripe_invoice: invoice.id ?? null,
    p_invoice: invoice.metadata?.invoice_id ?? null,
    p_event: kind,
    p_amount_paid: invoice.amount_paid ?? null,
    p_hosted: invoice.hosted_invoice_url ?? null,
    p_pdf: invoice.invoice_pdf ?? null,
    p_number: invoice.number ?? null,
    p_due: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10) : null,
  });
  if (error) throw new Error(error.message);
  return `school_${String(data)}`;
}

/**
 * Apply one verified Stripe event. Every database change goes through an
 * atomic stripe_* SQL function (one transaction each). Unknown events are
 * acknowledged. Throwing makes the route answer 500 so Stripe retries.
 */
export async function handleStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<string> {
  const { admin } = deps;
  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      const { data: outcome, error } = await admin.rpc("stripe_payment_succeeded", {
        p_payment_intent: pi.id,
        p_amount_received: pi.amount_received,
      });
      if (error) throw new Error(error.message);
      const orderId = pi.metadata?.order_id;
      if (outcome === "paid" && orderId) await queueOrderConfirmation(admin, orderId);
      if (outcome === "refund_expired" && orderId) await deps.refundInFull(orderId, "Paid after the order expired");
      return String(outcome);
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      must(
        await admin.rpc("stripe_payment_failed", {
          p_payment_intent: pi.id,
          p_error: pi.last_payment_error?.message ?? pi.last_payment_error?.code ?? "Payment failed",
          p_requires_action: false,
        }),
      );
      return "failed";
    }
    case "payment_intent.canceled": {
      must(await admin.rpc("stripe_payment_canceled", { p_payment_intent: event.data.object.id }));
      return "canceled";
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!pi) return "ignored";
      must(
        await admin.rpc("stripe_payment_refunded", { p_payment_intent: pi, p_refunded_total: charge.amount_refunded }),
      );
      return "refunded";
    }
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const refund = event.data.object;
      const row = refund.metadata?.refund_row;
      if (!row) return "ignored";
      const status =
        refund.status === "succeeded"
          ? "succeeded"
          : refund.status === "failed" || refund.status === "canceled"
            ? "failed"
            : "pending";
      must(
        await admin.rpc("stripe_record_refund", {
          p_refund: row,
          p_stripe_refund: refund.id,
          p_status: status,
          p_error: refund.failure_reason ?? null,
        }),
      );
      return status;
    }
    case "checkout.session.completed":
      // We use the Payment Element, not hosted Checkout; nothing to do (acknowledged).
      return "ignored";
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const sub = event.data.object;
      const item = sub.items.data[0];
      const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
      if (!SUB_STATUS.has(status)) return "ignored";
      const { data, error } = await admin.rpc("stripe_sync_subscription", {
        p_subscription: sub.metadata?.subscription_id ?? null,
        p_stripe_subscription: sub.id,
        p_status: status,
        p_period_start: ts(item?.current_period_start),
        p_period_end: ts(item?.current_period_end),
        p_cancel_at_period_end: sub.cancel_at_period_end,
        p_paused_until: ts(sub.pause_collection?.resumes_at),
        p_quantity: item?.quantity ?? 1,
        p_stripe_price: item?.price?.id ?? null,
        p_event_at: ts(event.created),
      });
      if (error) throw new Error(error.message);
      return data ? "synced" : "unknown_subscription";
    }
    case "invoice.paid": {
      const invoice = event.data.object;
      const { stripeSub, ours, periodStart, periodEnd } = invoiceSubscription(invoice);
      if (stripeSub || ours) {
        if (!periodStart || !periodEnd) return "no_period";
        must(
          await admin.rpc("stripe_invoice_paid", {
            p_subscription: ours,
            p_stripe_subscription: stripeSub,
            p_period_start: periodStart,
            p_period_end: periodEnd,
          }),
        );
        return "allowances";
      }
      return schoolInvoiceEvent(admin, invoice, "paid");
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const { stripeSub, ours } = invoiceSubscription(invoice);
      if (!stripeSub && !ours) return schoolInvoiceEvent(admin, invoice, "payment_failed");
      must(
        await admin.rpc("stripe_invoice_failed", {
          p_subscription: ours,
          p_stripe_subscription: stripeSub,
          p_attempt: invoice.attempt_count ?? 1,
          p_next_attempt: ts(invoice.next_payment_attempt),
        }),
      );
      return "dunning";
    }
    case "invoice.finalized":
    case "invoice.voided":
    case "invoice.overdue":
    case "invoice.marked_uncollectible": {
      // School invoices (Phase 7). Subscription invoices need nothing here.
      const invoice = event.data.object;
      if (invoiceSubscription(invoice).stripeSub) return "ignored";
      const kind = {
        "invoice.finalized": "finalized",
        "invoice.voided": "voided",
        "invoice.overdue": "overdue",
        "invoice.marked_uncollectible": "uncollectible",
      }[event.type];
      return schoolInvoiceEvent(admin, invoice, kind);
    }
    default:
      return "ignored";
  }
}
