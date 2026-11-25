import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { sendTemplate } from "@/lib/email/send";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDay, formatInZone } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Scheduled job (Vercel Cron, every 15 minutes): sends queued notifications,
 * e.g. "here's what we picked" after subscription auto-fill at cutoff. The
 * auto-fill itself runs in Postgres (pg_cron → auto_fill_due_weeks).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });

  // Service role: a background job with no user session; it reads queued
  // rows and order lines across households to email each family their own.
  const admin = createAdminClient();
  const { data: queued } = await admin
    .from("notifications_log")
    .select("id, to_address, template_key, payload, household_id, organization_id")
    .eq("status", "queued")
    .order("sent_at")
    .limit(50);

  let sent = 0;
  for (const n of queued ?? []) {
    // Claim the row first so overlapping runs never double-send.
    const { data: claimed } = await admin
      .from("notifications_log")
      .update({ status: "sending" })
      .eq("id", n.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    const payload = (n.payload ?? {}) as {
      order_id?: string;
      week_start?: string;
      cutoff?: string;
      invoice_id?: string;
      days_overdue?: number;
      school_name?: string;
    };
    const { data: who } = n.household_id
      ? await admin.from("households").select("primary_user_id").eq("id", n.household_id).maybeSingle()
      : { data: null };
    const { data: profile } = who?.primary_user_id
      ? await admin.from("profiles").select("full_name").eq("id", who.primary_user_id).maybeSingle()
      : { data: null };
    const vars: Record<string, string> = {
      first_name: (profile?.full_name as string | null)?.split(" ")[0] ?? "there",
      update_card_url: new URL("/subscription?billing=1", env.NEXT_PUBLIC_SITE_URL).toString(),
      week_of: payload.week_start ? formatDay(payload.week_start, { month: "short", day: "numeric" }) : "",
      cutoff: payload.cutoff ? formatInZone(payload.cutoff, "America/Los_Angeles") : "",
      portal_url: new URL("/school", env.NEXT_PUBLIC_SITE_URL).toString(),
      school_name: payload.school_name ?? "",
    };
    // Phase 8 emails carry their display values in the payload (written by
    // database functions): allergy conflict details, delivery date, pay link.
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof v === "string" && !(k in vars) && /^[a-z_]{2,40}$/.test(k)) vars[k] = v;
    }
    const raw = payload as { delivery_date?: string; order_id?: string };
    if (raw.delivery_date)
      vars.delivery_date = formatDay(raw.delivery_date, { weekday: "long", month: "short", day: "numeric" });
    if (raw.order_id) vars.pay_url = new URL(`/checkout?order=${raw.order_id}`, env.NEXT_PUBLIC_SITE_URL).toString();
    if (n.organization_id) {
      // School emails (Phase 7): school name, admin link, invoice details.
      const { data: org } = await admin.from("organizations").select("name").eq("id", n.organization_id).maybeSingle();
      vars.school_name ||= (org?.name as string | undefined) ?? "";
      vars.admin_url = new URL(`/admin/schools/${n.organization_id}`, env.NEXT_PUBLIC_SITE_URL).toString();
    }
    if (payload.invoice_id) {
      const { data: inv } = await admin
        .from("invoices")
        .select(
          "number, period_start, period_end, total_cents, amount_paid_cents, due_date, hosted_invoice_url, status",
        )
        .eq("id", payload.invoice_id)
        .maybeSingle();
      // A reminder for an invoice that has since been paid is dropped.
      if (inv && n.template_key === "school_invoice_reminder" && inv.status !== "open") {
        await admin
          .from("notifications_log")
          .update({ status: "failed", error: "invoice no longer open" })
          .eq("id", n.id);
        continue;
      }
      if (inv) {
        const day = (d: string) => formatDay(d, { month: "short", day: "numeric", year: "numeric" });
        vars.invoice_number = (inv.number as string | null) ?? "";
        vars.period = `${day(inv.period_start as string)} – ${day(inv.period_end as string)}`;
        vars.amount = formatCents((inv.total_cents as number) - (inv.amount_paid_cents as number));
        vars.due_date = inv.due_date ? day(inv.due_date as string) : "";
        vars.invoice_url =
          (inv.hosted_invoice_url as string | null) ?? new URL("/school/billing", env.NEXT_PUBLIC_SITE_URL).toString();
        vars.days_overdue = String(payload.days_overdue ?? "");
      }
    }
    if (payload.order_id) {
      const { data: order } = await admin
        .from("orders")
        .select("order_number, order_items ( item_name, delivery_date, children ( first_name ) )")
        .eq("id", payload.order_id)
        .maybeSingle();
      if (order) {
        type Item = { item_name: string; delivery_date: string | null; children: { first_name: string } | null };
        const items = (order.order_items as unknown as Item[]) ?? [];
        vars.order_number = order.order_number as string;
        vars.meals = items
          .sort((a, b) => (a.delivery_date ?? "").localeCompare(b.delivery_date ?? ""))
          .map(
            (i) =>
              `${i.children?.first_name ?? ""} · ${i.delivery_date ? formatDay(i.delivery_date, { weekday: "short" }) : ""} · ${i.item_name}`,
          )
          .join("\n");
        vars.delivery_dates = [...new Set(items.map((i) => i.delivery_date).filter(Boolean))]
          .map((d) => formatDay(d!))
          .join(", ");
      }
    }
    const res = await sendTemplate(admin, n.template_key as string, n.to_address as string, vars);
    await admin
      .from("notifications_log")
      .update(
        res.ok
          ? { status: "sent", provider_id: res.providerId, sent_at: new Date().toISOString() }
          : { status: "failed", error: res.error.slice(0, 300) },
      )
      .eq("id", n.id);
    if (res.ok) sent++;
  }
  return NextResponse.json({ processed: queued?.length ?? 0, sent });
}
