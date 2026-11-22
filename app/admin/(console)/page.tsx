import { AlertTriangle, BookOpen, ClipboardList, School, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { estimateStripeFeeCents, monthlyValueCents } from "@/lib/admin/payment-status";
import { formatCents } from "@/lib/money";
import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { addDays, formatDay, fromZonedInput, todayInZone } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard" };

const PAID = ["paid", "invoiced", "fulfilled", "partially_refunded"];

function Stat({ label, value, href, icon }: { label: string; value: ReactNode; href?: string; icon: ReactNode }) {
  const body = (
    <div className="flex h-full items-center gap-3 rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink-sm">
      <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink bg-orange">
        {icon}
      </span>
      <span>
        <span className="block text-2xl font-bold">{value}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-3">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function AdminDashboardPage() {
  const user = await requireStaffAAL2();
  const isOps = user.roles.some((r) => r === "ops" || r === "owner");
  const isOwner = user.roles.includes("owner");
  const supabase = await createClient();
  const today = todayInZone("America/Los_Angeles");
  const { data: weeks } = await supabase
    .from("menu_weeks")
    .select("id, week_start, status, cutoff_at")
    .gte("week_start", today)
    .order("week_start")
    .limit(3);
  const nextWeek = weeks?.[0];

  const [orders, pendingSchools, subs, drafts] = await Promise.all([
    isOps && nextWeek
      ? supabase.from("orders").select("total_cents, status").eq("menu_week_id", nextWeek.id).neq("status", "draft")
      : Promise.resolve({ data: null }),
    isOps
      ? supabase.from("organizations").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: null }),
    isOps
      ? supabase.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "trialing"])
      : Promise.resolve({ count: null }),
    isOwner
      ? supabase
          .from("menu_weeks")
          .select("id, week_start")
          .eq("status", "draft")
          .gte("week_start", today)
          .order("week_start")
          .limit(3)
      : Promise.resolve({ data: null }),
  ]);
  // Revenue summary (Phase 6): money actually collected, net of refunds.
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const since = (d: string) => fromZonedInput(`${d}T00:00`, "America/Los_Angeles")!;
  const [monthPays, activeSubs, failedOrders, failedSubs] = isOps
    ? await Promise.all([
        supabase
          .from("order_payments")
          .select("amount_cents, refunded_cents, created_at")
          .eq("status", "succeeded")
          .gte("created_at", since(monthStart < monday ? monthStart : monday)),
        supabase
          .from("subscriptions")
          .select("quantity, plans!subscriptions_plan_id_fkey ( price_cents, billing_interval )")
          .in("status", ["active", "trialing"]),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_payment")
          .not("payment_failed_at", "is", null),
        supabase
          .from("subscriptions")
          .select("id", { count: "exact", head: true })
          .in("status", ["past_due", "unpaid"]),
      ])
    : [{ data: [] }, { data: [] }, { count: 0 }, { count: 0 }];
  const pays = (monthPays.data ?? []) as { amount_cents: number; refunded_cents: number; created_at: string }[];
  const net = (from: string) =>
    pays.filter((p) => p.created_at >= since(from)).reduce((s, p) => s + p.amount_cents - p.refunded_cents, 0);
  const weekRevenue = net(monday);
  const monthRevenue = net(monthStart);
  const monthFees = pays
    .filter((p) => p.created_at >= since(monthStart))
    .reduce((s, p) => s + estimateStripeFeeCents(p.amount_cents), 0);
  const mrr = (
    (activeSubs.data ?? []) as unknown as {
      quantity: number;
      plans: { price_cents: number; billing_interval: "week" | "two_weeks" | "month" } | null;
    }[]
  ).reduce(
    (s, x) => s + (x.plans ? monthlyValueCents(x.plans.price_cents, x.quantity, x.plans.billing_interval) : 0),
    0,
  );
  const attention = (failedOrders.count ?? 0) + (failedSubs.count ?? 0);
  const weekOrders = (orders.data ?? []) as { total_cents: number; status: string }[];
  const revenue = weekOrders.filter((o) => PAID.includes(o.status)).reduce((s, o) => s + o.total_cents, 0);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          nextWeek
            ? `Next menu: week of ${formatDay(nextWeek.week_start, { month: "long", day: "numeric" })}`
            : "No upcoming menu weeks yet."
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isOps ? (
          <Stat
            label="Orders for next week"
            value={weekOrders.length}
            href={nextWeek ? `/admin/orders?week=${nextWeek.id}` : "/admin/orders"}
            icon={<ClipboardList aria-hidden="true" className="size-5" />}
          />
        ) : null}
        {isOps ? (
          <Stat
            label="Paid for next week"
            value={formatCents(revenue)}
            icon={
              <span aria-hidden="true" className="font-bold">
                $
              </span>
            }
          />
        ) : null}
        {isOps ? (
          <Stat
            label="Active subscribers"
            value={subs.count ?? 0}
            href="/admin/customers"
            icon={<Users aria-hidden="true" className="size-5" />}
          />
        ) : null}
        {isOps ? (
          <Stat
            label="Schools awaiting approval"
            value={pendingSchools.count ?? 0}
            href="/admin/schools?status=pending"
            icon={<School aria-hidden="true" className="size-5" />}
          />
        ) : null}
        {!isOps ? (
          <Stat
            label="Kitchen view"
            value="Cook list"
            href="/admin/kitchen"
            icon={<BookOpen aria-hidden="true" className="size-5" />}
          />
        ) : null}
      </div>
      {isOps ? (
        <section aria-labelledby="revenue" className="rounded-2xl border-2 border-ink bg-paper p-4">
          <h2 id="revenue" className="mb-3 font-bold">
            Revenue
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["This week", formatCents(weekRevenue)],
              ["This month", formatCents(monthRevenue)],
              ["Monthly recurring (plans)", formatCents(mrr)],
              ["Active subscribers", String(activeSubs.data?.length ?? 0)],
              ["Stripe fees this month (est.)", formatCents(monthFees)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Collected payments net of refunds. Fees are an estimate (2.9% + 30¢ per card payment); the Stripe dashboard
            has the exact amounts.
          </p>
          {attention ? (
            <Link
              href="/admin/orders?pay=failed"
              className="mt-3 inline-flex items-center gap-2 rounded-md border-2 border-destructive px-3 py-1.5 text-sm font-bold text-destructive"
            >
              <AlertTriangle aria-hidden="true" className="size-4" /> {attention} failed payment
              {attention === 1 ? "" : "s"} need attention
            </Link>
          ) : null}
        </section>
      ) : null}
      {isOwner && (drafts.data ?? []).length ? (
        <section className="rounded-2xl border-2 border-ink bg-accent/40 p-4" aria-labelledby="todo">
          <h2 id="todo" className="flex items-center gap-2 font-bold">
            <AlertTriangle aria-hidden="true" className="size-4" /> To do
          </h2>
          <ul className="mt-2 list-disc pl-5">
            {(drafts.data ?? []).map((w: { id: string; week_start: string }) => (
              <li key={w.id}>
                <Link className="underline" href={`/admin/menu/weeks/${w.id}`}>
                  Week of {formatDay(w.week_start)}
                </Link>{" "}
                is still a draft. Publish it so families can order.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {isOwner ? (
        <section aria-labelledby="quick" className="rounded-2xl border-2 border-ink bg-paper p-4">
          <h2 id="quick" className="mb-3 font-bold">
            Quick links
          </h2>
          <div className="flex flex-wrap gap-2">
            {[
              ["/admin/menu/weeks", "Build a weekly menu"],
              ["/admin/menu", "Edit meals"],
              ["/admin/content", "Edit site text"],
              ["/admin/settings", "Settings"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href!}
                className="rounded-md border-2 border-ink bg-orange px-3 py-2 text-sm font-bold shadow-ink-sm"
              >
                {label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
