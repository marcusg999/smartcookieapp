import Link from "next/link";
import { notFound } from "next/navigation";

import { PageTitle } from "@/components/family/kit";
import { WeekOrders } from "@/components/school/week-orders";
import { getContent } from "@/lib/content/content";
import {
  getAdjustments,
  getClassrooms,
  getClosures,
  getSchoolContext,
  getSchoolWeeks,
  getStandingOrders,
  getWeekOrders,
  getWeekSchoolItems,
} from "@/lib/school/queries";
import { isWeekOpen, pickWeek } from "@/lib/school/weeks";
import { formatDay } from "@/lib/time";

export const metadata = { title: "Weekly orders" };

export default async function SchoolOrdersPage({ searchParams }: PageProps<"/school/orders">) {
  const [c, ctx, weeks] = await Promise.all([getContent(), getSchoolContext(), getSchoolWeeks()]);
  if (!ctx) notFound();
  const wanted = String((await searchParams).week ?? "");
  const week = pickWeek(weeks, wanted);
  if (!week) {
    return (
      <div>
        <PageTitle sub={c.text("school.orders.subtitle")}>{c.text("school.orders.title")}</PageTitle>
        <p className="text-muted-foreground">{c.text("school.orders.no_weeks")}</p>
      </div>
    );
  }
  const orgId = ctx.school.id;
  const [orders, standing, rooms, items, closures] = await Promise.all([
    getWeekOrders(orgId, week.id),
    getStandingOrders(orgId),
    getClassrooms(orgId),
    getWeekSchoolItems(week.id),
    getClosures(orgId),
  ]);
  const adjustments = await getAdjustments(standing.map((s) => s.id));
  const open = isWeekOpen(week);
  return (
    <div>
      <PageTitle sub={c.text("school.orders.subtitle")}>{c.text("school.orders.title")}</PageTitle>
      <nav aria-label={c.text("school.orders.weeks_label")} className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {weeks.map((w) => (
          <Link
            key={w.id}
            href={`/school/orders?week=${w.id}`}
            aria-current={w.id === week.id ? "page" : undefined}
            className={`shrink-0 rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold ${w.id === week.id ? "bg-orange shadow-ink-sm" : "bg-paper"}`}
          >
            {c.text("school.orders.week_of", { date: formatDay(w.week_start, { month: "short", day: "numeric" }) })}
          </Link>
        ))}
      </nav>
      <WeekOrders
        copy={c.group("school.")}
        week={week}
        open={open}
        orders={orders}
        standingOrders={standing}
        classrooms={rooms}
        adjustments={adjustments}
        items={items}
        closures={closures}
        isAdmin={ctx.role === "school_admin"}
      />
    </div>
  );
}
