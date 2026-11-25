import { notFound } from "next/navigation";

import { PageTitle, Panel } from "@/components/family/kit";
import { BulkOrderForm } from "@/components/school/bulk-order-form";
import { getContent } from "@/lib/content/content";
import { getClassrooms, getSchoolContext, getSchoolWeeks, getWeekSchoolItems } from "@/lib/school/queries";
import { isWeekOpen } from "@/lib/school/weeks";
import { formatDay } from "@/lib/time";

export const metadata = { title: "Bulk order" };

export default async function BulkOrderPage() {
  const [c, ctx, weeks] = await Promise.all([getContent(), getSchoolContext(), getSchoolWeeks()]);
  if (!ctx || ctx.role !== "school_admin" || ctx.school.status !== "approved") notFound();
  const open = weeks.filter((w) => isWeekOpen(w));
  const [rooms, ...items] = await Promise.all([
    getClassrooms(ctx.school.id),
    ...open.map((w) => getWeekSchoolItems(w.id)),
  ]);
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageTitle sub={c.text("school.bulk.subtitle")}>{c.text("school.bulk.title")}</PageTitle>
      <Panel>
        <BulkOrderForm
          copy={c.group("school.")}
          classrooms={rooms}
          weeks={open
            .map((w, i) => ({
              id: w.id,
              label: c.text("school.orders.week_of", {
                date: formatDay(w.week_start, { month: "short", day: "numeric" }),
              }),
              delivery_dates: w.delivery_dates,
              items: items[i] ?? [],
            }))
            .filter((w) => w.items.length > 0)}
        />
      </Panel>
    </div>
  );
}
