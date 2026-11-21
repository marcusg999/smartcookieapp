import Link from "next/link";

import { formatCents } from "@/components/admin/fields";
import { EmptyState, PageHeader, StatusPill } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { formatDay, formatInZone } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Orders" };
const STATUSES = ["all", "pending_payment", "paid", "invoiced", "fulfilled", "cancelled", "refunded"] as const;

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireStaffAAL2(["ops", "owner"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: weeks } = await supabase.from("menu_weeks").select("id, week_start").order("week_start", { ascending: false }).limit(12);
  const weekId = typeof sp.week === "string" && weeks?.some((w) => w.id === sp.week) ? sp.week : null;
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "all";
  let q = supabase
    .from("orders")
    .select("id, order_number, status, source, fulfillment, total_cents, placed_at, created_at, delivery_date, households(name), organizations(name), order_items(quantity)")
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(200);
  if (weekId) q = q.eq("menu_week_id", weekId);
  if (status !== "all") q = q.eq("status", status);
  const { data: orders } = await q;
  const link = (p: Record<string, string | null>) => {
    const s = new URLSearchParams(Object.entries({ week: weekId, status: status === "all" ? null : status, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/admin/orders${s.size ? `?${s}` : ""}`;
  };
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Orders" description="Family and school orders. Payments and refunds arrive in a later phase." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={link({ week: null })} aria-current={!weekId ? "page" : undefined} className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold ${!weekId ? "bg-orange" : "bg-paper"}`}>All weeks</Link>
        {(weeks ?? []).map((w) => (
          <Link key={w.id} href={link({ week: w.id })} aria-current={w.id === weekId ? "page" : undefined} className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold ${w.id === weekId ? "bg-orange" : "bg-paper"}`}>Week of {formatDay(w.week_start)}</Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link key={s} href={link({ status: s === "all" ? null : s })} aria-current={s === status ? "page" : undefined} className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-semibold capitalize ${s === status ? "bg-orange" : "bg-paper"}`}>{s.replace("_", " ")}</Link>
        ))}
      </div>
      {(orders ?? []).length === 0 ? <EmptyState title="No orders" body="Orders appear here once families check out." /> : (
        <div className="overflow-x-auto rounded-2xl border-2 border-ink bg-paper">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead><tr className="border-b-2 border-ink"><th className="px-3 py-2">Order</th><th>Customer</th><th>Meals</th><th>Delivery</th><th>Status</th><th className="px-3 text-right">Total</th></tr></thead>
            <tbody>
              {(orders ?? []).map((o) => {
                const who = (o.households as unknown as { name: string } | null)?.name ?? (o.organizations as unknown as { name: string } | null)?.name ?? "Deleted account";
                const meals = (o.order_items ?? []).reduce((s: number, i: { quantity: number }) => s + i.quantity, 0);
                return (
                  <tr key={o.id} className="border-b border-ink/10">
                    <td className="px-3 py-2"><span className="font-mono">{o.order_number}</span><span className="block text-xs text-muted-foreground">{formatInZone(o.placed_at ?? o.created_at, "America/Los_Angeles", { dateStyle: "medium" })}</span></td>
                    <td>{who}</td>
                    <td>{meals}</td>
                    <td>{o.fulfillment === "school_dropoff" ? "School" : "Home"}{o.delivery_date ? ` · ${formatDay(o.delivery_date)}` : ""}</td>
                    <td><StatusPill status={o.status} label={o.status.replace("_", " ")} /></td>
                    <td className="px-3 text-right font-semibold">{formatCents(o.total_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
