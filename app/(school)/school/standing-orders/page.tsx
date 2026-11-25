import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageTitle, Panel } from "@/components/family/kit";
import { StatusTag } from "@/components/school/kit";
import { buttonVariants } from "@/components/ui/button";
import { getContent } from "@/lib/content/content";
import { getClassrooms, getSchoolContext, getStandingOrders } from "@/lib/school/queries";
import { formatDay } from "@/lib/time";

export const metadata = { title: "Standing orders" };

export default async function StandingOrdersPage() {
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx) notFound();
  const [orders, rooms] = await Promise.all([getStandingOrders(ctx.school.id), getClassrooms(ctx.school.id)]);
  const isAdmin = ctx.role === "school_admin";
  const room = (id: string | null) => rooms.find((r) => r.id === id);
  return (
    <div>
      <PageTitle sub={c.text("school.standing.subtitle")}>{c.text("school.standing.title")}</PageTitle>
      {isAdmin ? (
        rooms.length ? (
          <Link href="/school/standing-orders/new" className={buttonVariants({ className: "mb-6" })}>
            <Plus aria-hidden="true" /> {c.text("school.standing.new")}
          </Link>
        ) : (
          <p className="mb-6 text-muted-foreground">
            <Link href="/school/classrooms" className="font-semibold underline">
              {c.text("school.standing.need_classroom")}
            </Link>
          </p>
        )
      ) : null}
      {orders.length === 0 ? (
        <p className="text-muted-foreground">{c.text("school.standing.empty")}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {orders.map((o) => {
            const r = room(o.classroom_id);
            const qty =
              o.quantity_mode === "fixed"
                ? c.text("school.standing.fixed_summary", { count: String(o.fixed_quantity ?? 0) })
                : c.text("school.standing.headcount_summary", {
                    count: String(r?.headcount ?? 0),
                    buffer: String(o.buffer_percent),
                  });
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-xl font-bold">{o.name}</h2>
                  <StatusTag tone={o.status === "active" ? "ok" : "muted"}>
                    {c.text(`school.standing.status_${o.status}`)}
                  </StatusTag>
                </div>
                <p className="text-sm text-muted-foreground">
                  {r?.name} · {o.weekdays.map((d) => c.text(`school.day.${d}`)).join(", ")}
                </p>
                <p className="text-sm">
                  {qty} · {c.text(`school.standing.mode_${o.menu_selection_mode}`)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {c.text("school.standing.dates", {
                    start: formatDay(o.start_date, { month: "short", day: "numeric", year: "numeric" }),
                    end: o.end_date
                      ? formatDay(o.end_date, { month: "short", day: "numeric", year: "numeric" })
                      : c.text("school.standing.no_end"),
                  })}
                </p>
              </>
            );
            return (
              <Panel as="li" key={o.id} className="space-y-1">
                {isAdmin ? (
                  <Link
                    href={`/school/standing-orders/${o.id}`}
                    className="block space-y-1 focus-visible:outline-3 focus-visible:outline-ink"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </Panel>
            );
          })}
        </ul>
      )}
    </div>
  );
}
