import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Countdown, PageTitle, Panel } from "@/components/family/kit";
import { getContent } from "@/lib/content/content";
import { formatCents } from "@/lib/money";
import {
  getClassrooms,
  getInvoices,
  getRoster,
  getSchoolContext,
  getSchoolWeeks,
  getWeekOrders,
} from "@/lib/school/queries";
import { currentWeek, isWeekOpen } from "@/lib/school/weeks";
import { formatDay, todayInZone } from "@/lib/time";

export const metadata = { title: "School portal" };

/** This week at a glance: deliveries, headcounts, allergy-safe meals, cutoff, to-dos, balance. */
export default async function SchoolHomePage() {
  const [c, ctx, weeks] = await Promise.all([getContent(), getSchoolContext(), getSchoolWeeks()]);
  if (!ctx) notFound();
  const { school, role } = ctx;
  const isAdmin = role === "school_admin";
  const orgId = school.id;
  const today = todayInZone("America/Los_Angeles");
  const thisWeek = currentWeek(weeks, today);
  const nextOpen = weeks.find((w) => isWeekOpen(w));
  const [rooms, roster, invoices, weekOrders, openOrders] = await Promise.all([
    getClassrooms(orgId),
    getRoster(orgId),
    isAdmin ? getInvoices(orgId) : Promise.resolve([]),
    thisWeek ? getWeekOrders(orgId, thisWeek.id) : Promise.resolve([]),
    nextOpen ? getWeekOrders(orgId, nextOpen.id) : Promise.resolve([]),
  ]);
  const pendingLinks = roster.filter((r) => r.link_status === "pending").length;
  const toReview = openOrders.filter((o) => o.needs_review || !o.school_reviewed_at).length;
  const outstanding = invoices
    .filter((i) => i.status === "open")
    .reduce((s, i) => s + i.total_cents - i.amount_paid_cents, 0);
  const lines = weekOrders.flatMap((o) => o.lines);
  const days = thisWeek ? thisWeek.delivery_dates.filter((d) => lines.some((l) => l.delivery_date === d)) : [];
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? c.text("school.home.other");

  return (
    <div className="space-y-6">
      <PageTitle sub={c.text("school.home.subtitle")}>{c.text("school.home.title", { name: school.name })}</PageTitle>

      {isAdmin && !school.onboarded_at ? (
        <Panel className="flex flex-wrap items-center justify-between gap-3 bg-orange-tint">
          <div>
            <h2 className="text-xl font-bold">{c.text("school.home.setup_title")}</h2>
            <p className="text-sm">{c.text("school.home.setup_body")}</p>
          </div>
          <Link
            href="/school/setup"
            className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-orange px-3 py-2 font-bold shadow-ink-sm"
          >
            {c.text("school.home.setup_cta")} <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Panel>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <p className="text-sm font-semibold">{c.text("school.home.next_cutoff")}</p>
          {nextOpen ? (
            <>
              <p className="text-2xl font-black">
                <Countdown
                  cutoff={nextOpen.cutoff}
                  template={c.text("school.home.countdown")}
                  closedLabel={c.text("school.orders.locked")}
                />
              </p>
              <p className="text-sm text-muted-foreground">
                {c.text("school.orders.week_of", {
                  date: formatDay(nextOpen.week_start, { month: "short", day: "numeric" }),
                })}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{c.text("school.home.no_open_week")}</p>
          )}
        </Panel>
        <Panel>
          <p className="text-sm font-semibold">{c.text("school.home.to_review")}</p>
          <p className="text-2xl font-black">{toReview + (isAdmin ? pendingLinks : 0)}</p>
          <ul className="text-sm">
            {toReview ? (
              <li>
                <Link href={nextOpen ? `/school/orders?week=${nextOpen.id}` : "/school/orders"} className="underline">
                  {c.text("school.home.orders_to_review", { count: String(toReview) })}
                </Link>
              </li>
            ) : null}
            {isAdmin && pendingLinks ? (
              <li>
                <Link href="/school/classrooms" className="underline">
                  {c.text("school.home.links_to_review", { count: String(pendingLinks) })}
                </Link>
              </li>
            ) : null}
          </ul>
        </Panel>
        <Panel>
          <p className="text-sm font-semibold">{c.text("school.home.students")}</p>
          <p className="text-2xl font-black">{rooms.reduce((s, r) => s + r.headcount, 0)}</p>
          <p className="text-sm text-muted-foreground">
            {c.text("school.home.in_classrooms", { count: String(rooms.length) })}
          </p>
        </Panel>
        {isAdmin ? (
          <Panel>
            <p className="text-sm font-semibold">{c.text("school.home.balance")}</p>
            <p className="text-2xl font-black">{formatCents(outstanding)}</p>
            <Link href="/school/billing" className="text-sm underline">
              {c.text("school.home.view_billing")}
            </Link>
          </Panel>
        ) : null}
      </div>

      <Panel>
        <h2 className="mb-1 text-xl font-bold">
          {thisWeek
            ? c.text("school.home.week_title", {
                date: formatDay(thisWeek.week_start, { month: "short", day: "numeric" }),
              })
            : c.text("school.home.week_title_none")}
        </h2>
        {days.length === 0 ? (
          <p className="text-muted-foreground">{c.text("school.home.no_deliveries")}</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {days.map((d) => {
              const dayLines = lines.filter((l) => l.delivery_date === d);
              const byRoom = [...new Set(dayLines.map((l) => l.classroom_id))];
              return (
                <section
                  key={d}
                  className="rounded-xl border-2 border-ink/20 p-3"
                  aria-label={formatDay(d, { weekday: "long" })}
                >
                  <h3 className="font-bold">{formatDay(d, { weekday: "long", month: "short", day: "numeric" })}</h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {byRoom.map((roomId) => {
                      const rl = dayLines.filter((l) => l.classroom_id === roomId);
                      const meals = rl.reduce((s, l) => s + l.quantity, 0);
                      const safe = rl.filter((l) => l.safe_for_allergens.length).reduce((s, l) => s + l.quantity, 0);
                      return (
                        <li key={roomId ?? "other"} className="flex flex-wrap justify-between gap-1">
                          <span className="font-semibold">{roomName(roomId)}</span>
                          <span>
                            {c.text("school.home.meals", { count: String(meals) })}
                            {safe ? (
                              <span className="ml-2 inline-flex items-center gap-1 font-bold text-allergy">
                                <AlertTriangle aria-hidden="true" className="size-3" />
                                {c.text("school.home.safe_meals", { count: String(safe) })}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
