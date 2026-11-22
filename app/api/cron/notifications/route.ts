import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sendTemplate } from "@/lib/email/send";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDay } from "@/lib/time";

export const dynamic = "force-dynamic";

function authorized(header: string | null): boolean {
  if (!env.CRON_SECRET || !header) return false;
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled job (Vercel Cron, every 15 minutes): sends queued notifications,
 * e.g. "here's what we picked" after subscription auto-fill at cutoff. The
 * auto-fill itself runs in Postgres (pg_cron → auto_fill_due_weeks).
 */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });

  // Service role: a background job with no user session; it reads queued
  // rows and order lines across households to email each family their own.
  const admin = createAdminClient();
  const { data: queued } = await admin
    .from("notifications_log")
    .select("id, to_address, template_key, payload")
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
    const payload = (n.payload ?? {}) as { order_id?: string; week_start?: string };
    const vars: Record<string, string> = {
      week_of: payload.week_start ? formatDay(payload.week_start, { month: "short", day: "numeric" }) : "",
    };
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
