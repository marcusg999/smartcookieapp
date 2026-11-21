import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { PageTitle } from "@/components/family/kit";
import { fmt } from "@/lib/content/fmt";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getHousehold, getOrders, type OrderSummary } from "@/lib/family/queries";
import { formatCents } from "@/lib/money";
import { addDays, formatDay } from "@/lib/time";

export const metadata = { title: "Orders" };

const LIVE = ["pending_payment", "paid", "invoiced"];

export default async function OrdersPage() {
  await requireUser("/orders");
  const [c, household] = await Promise.all([getContent(), getHousehold()]);
  const orders = household ? await getOrders(household.id) : [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = orders.filter((o) => LIVE.includes(o.status) && addDays(o.week_start, 6) >= today);
  const past = orders.filter((o) => !upcoming.includes(o));

  const row = (o: OrderSummary) => (
    <li key={o.id}>
      <Link
        href={`/orders/${o.id}`}
        className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-ink"
      >
        <span className="space-y-0.5">
          <span className="block font-black">
            {fmt(c.text("orders.week_of"), { date: formatDay(o.week_start, { month: "short", day: "numeric" }) })}
          </span>
          <span className="block text-sm text-muted-foreground">
            {o.order_number} ·{" "}
            {o.item_count === 1 ? c.text("orders.item_one") : fmt(c.text("orders.items"), { count: o.item_count })}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-right">
            <span className="block font-bold">{formatCents(o.total_cents, o.currency)}</span>
            <span className="block rounded-full border-2 border-ink bg-orange-tint px-2 text-xs font-bold">
              {c.text(`orders.status_${o.status}`)}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="size-5" />
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle>{c.text("orders.title")}</PageTitle>
      {orders.length === 0 ? <p className="text-lg text-muted-foreground">{c.text("orders.empty")}</p> : null}
      {upcoming.length ? (
        <section aria-labelledby="up-h" className="mb-8">
          <h2 id="up-h" className="mb-3 text-2xl font-black">
            {c.text("orders.upcoming")}
          </h2>
          <ul className="space-y-3">{upcoming.map(row)}</ul>
        </section>
      ) : null}
      {past.length ? (
        <section aria-labelledby="past-h">
          <h2 id="past-h" className="mb-3 text-2xl font-black">
            {c.text("orders.past")}
          </h2>
          <ul className="space-y-3">{past.map(row)}</ul>
        </section>
      ) : null}
    </div>
  );
}
