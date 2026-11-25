import "server-only";

import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatDay, formatInZone } from "@/lib/time";

type Admin = ReturnType<typeof createAdminClient>;

/** A queued notifications_log row, as the worker reads it. */
export type QueuedEmail = {
  id: string;
  template_key: string;
  to_address: string | null;
  payload: Record<string, unknown> | null;
  household_id: string | null;
  organization_id: string | null;
  user_id: string | null;
};

/** The worker drops an email (status 'skipped') when this is returned. */
export class SkipEmail extends Error {}

const url = (path: string) => new URL(path, env.NEXT_PUBLIC_SITE_URL).toString();
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const shortDay = (d: string) => formatDay(d, { month: "short", day: "numeric" });

/**
 * Build the display values for one queued email from its payload (ids and
 * raw numbers written by SQL) and the database. Values are plain strings;
 * the template decides which of them it may show (lib/email/catalog.ts).
 * `copy` holds the email.* CMS strings (reason lines etc.).
 */
export async function buildVariables(
  admin: Admin,
  n: QueuedEmail,
  copy: Record<string, string>,
  timezone: string,
): Promise<Record<string, string>> {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  const v: Record<string, string> = {
    orders_url: url("/orders"),
    menu_url: url("/order"),
    order_week_url: url("/order"),
    plan_url: url("/subscription"),
    update_card_url: url("/subscription?billing=1"),
    portal_url: url("/school"),
    billing_url: url("/school/billing"),
    account_url: url("/account/security"),
    admin_week_url: url("/admin"),
    admin_payments_url: url("/admin/kitchen/payments"),
    admin_staff_url: url("/admin/staff"),
  };
  const day = (d: string) => formatDay(d, { month: "short", day: "numeric", year: "numeric" });

  // Values SQL already formatted for display (Phase 7/8 payloads: allergy
  // conflict details, school name, …). Ids and numbers are converted below.
  for (const [k, val] of Object.entries(p)) {
    if (typeof val === "string" && /^[a-z_]{2,40}$/.test(k) && !k.endsWith("_id") && k !== "deep_link_token")
      v[k] = val;
    if (typeof val === "number" && /^[a-z_]{2,40}$/.test(k) && !k.endsWith("_cents")) v[k] = String(val);
  }

  // Greeting: the household's primary parent (first name only).
  const userId = n.user_id ?? (await primaryUser(admin, n.household_id));
  if (userId) {
    const { data: profile } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    v.first_name = (profile?.full_name as string | null)?.trim().split(/\s+/)[0] || "there";
  } else {
    v.first_name = "there";
  }

  if (typeof p.week_start === "string") v.week_of = shortDay(p.week_start);
  if (typeof p.cutoff === "string") v.cutoff = formatInZone(p.cutoff, timezone);
  if (typeof p.delivery_date === "string")
    v.delivery_date = formatDay(p.delivery_date, { weekday: "long", month: "short", day: "numeric" });
  if (typeof p.signed_in_at === "string") v.signed_in_at = formatInZone(p.signed_in_at, timezone);
  if (typeof p.refund_cents === "number") v.refund_amount = formatCents(p.refund_cents);
  if (typeof p.overdue_cents === "number") v.overdue_amount = formatCents(p.overdue_cents);
  if (typeof p.reason === "string") v.reason_line = copy[`email.reason.${p.reason}`] ?? "";
  if (typeof p.deep_link_token === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(p.deep_link_token))
    v.repeat_url = url(`/r/${p.deep_link_token}`);

  // Orders: number, meals per child and day, total, allergy recap.
  if (typeof p.order_id === "string") {
    const { data: order } = await admin
      .from("orders")
      .select(
        "id, order_number, status, total_cents, currency, order_items ( item_name, delivery_date, quantity, child_id, children ( first_name ) )",
      )
      .eq("id", p.order_id)
      .maybeSingle();
    if (order) {
      type Item = {
        item_name: string;
        delivery_date: string | null;
        quantity: number;
        child_id: string | null;
        children: { first_name: string } | null;
      };
      const items = ((order.order_items as unknown as Item[]) ?? []).sort((a, b) =>
        (a.delivery_date ?? "").localeCompare(b.delivery_date ?? ""),
      );
      v.order_number = order.order_number as string;
      v.order_url = url(`/orders/${order.id}`);
      v.pay_url = url(`/checkout?order=${order.id}`);
      v.total = formatCents(order.total_cents as number);
      v.meals = items
        .map((i) =>
          [
            i.children?.first_name,
            i.delivery_date ? formatDay(i.delivery_date, { weekday: "short" }) : null,
            `${i.item_name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`,
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("\n");
      v.delivery_dates = [...new Set(items.map((i) => i.delivery_date).filter(Boolean))]
        .map((d) => formatDay(d!, { weekday: "short", month: "short", day: "numeric" }))
        .join(", ");
      if (n.template_key === "order_confirmation") {
        v.allergy_recap = await allergyRecap(
          admin,
          [...new Set(items.map((i) => i.child_id).filter(Boolean))] as string[],
          copy,
        );
      }
      // A payment reminder for an order that has since been paid is dropped.
      if (n.template_key === "payment_reminder" && order.status !== "pending_payment")
        throw new SkipEmail("order already paid");
    } else if (n.template_key !== "allergy_conflict") {
      throw new SkipEmail("order not found");
    }
  }

  // Plans: name, amount per billing period, renewal date, terms.
  if (typeof p.subscription_id === "string" || typeof p.plan_name === "string") {
    const qty = typeof p.quantity === "number" ? p.quantity : 1;
    if (typeof p.price_cents === "number") v.amount = formatCents(p.price_cents * qty);
    if (typeof p.period_end === "string") {
      v.renews_on = shortDay(p.period_end);
      v.ends_on = shortDay(p.period_end);
    }
    if (typeof p.paused_until === "string") v.paused_until = shortDay(p.paused_until);
    v.renewal_terms = str(p.renewal_terms) || copy["email.renewal_terms_fallback"] || "";
  }

  // School invoices.
  if (typeof p.invoice_id === "string") {
    const { data: inv } = await admin
      .from("invoices")
      .select("number, period_start, period_end, total_cents, amount_paid_cents, due_date, hosted_invoice_url, status")
      .eq("id", p.invoice_id)
      .maybeSingle();
    if (!inv) throw new SkipEmail("invoice not found");
    // Reminders for an invoice that has since been paid or voided are dropped.
    if (["school_invoice_reminder", "school_invoice_due_soon"].includes(n.template_key) && inv.status !== "open")
      throw new SkipEmail("invoice no longer open");
    v.invoice_number = (inv.number as string | null) ?? "";
    v.period = `${day(inv.period_start as string)} – ${day(inv.period_end as string)}`;
    v.amount =
      n.template_key === "school_invoice_paid"
        ? formatCents(inv.total_cents as number)
        : formatCents((inv.total_cents as number) - (inv.amount_paid_cents as number));
    v.due_date = inv.due_date ? day(inv.due_date as string) : "";
    v.invoice_url = (inv.hosted_invoice_url as string | null) ?? url("/school/billing");
  }
  if (n.organization_id) {
    const { data: org } = await admin.from("organizations").select("name").eq("id", n.organization_id).maybeSingle();
    v.school_name ||= (org?.name as string | undefined) ?? "";
    v.admin_url = url(`/admin/schools/${n.organization_id}`);
  }
  if (typeof p.role === "string") v.role = copy[`email.role.${p.role}`] || p.role;
  return v;
}

async function primaryUser(admin: Admin, householdId: string | null): Promise<string | null> {
  if (!householdId) return null;
  const { data } = await admin.from("households").select("primary_user_id").eq("id", householdId).maybeSingle();
  return (data?.primary_user_id as string | null) ?? null;
}

/** "Maya: sesame (severe). Leo: no allergies." from the children's current profiles. */
async function allergyRecap(admin: Admin, childIds: string[], copy: Record<string, string>): Promise<string> {
  if (!childIds.length) return "";
  const { data } = await admin
    .from("children")
    .select("first_name, child_allergens ( severity, allergens ( name ) )")
    .in("id", childIds)
    .order("first_name");
  type Row = { first_name: string; child_allergens: { severity: string | null; allergens: { name: string } | null }[] };
  return ((data as unknown as Row[]) ?? [])
    .map((c) => {
      const list = (c.child_allergens ?? [])
        .filter((a) => a.allergens)
        .map(
          (a) =>
            `${a.allergens!.name.toLowerCase()}${a.severity === "severe" ? ` (${copy["email.severe"] || "severe"})` : ""}`,
        );
      return `${c.first_name}: ${list.length ? list.join(", ") : copy["email.no_allergies"] || "no allergies"}.`;
    })
    .join(" ");
}
