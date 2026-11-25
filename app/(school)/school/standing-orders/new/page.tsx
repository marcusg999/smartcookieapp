import { notFound } from "next/navigation";

import { PageTitle, Panel } from "@/components/family/kit";
import { StandingOrderForm } from "@/components/school/standing-order-form";
import { emptyStandingOrder } from "@/lib/school/standing";
import { getContent } from "@/lib/content/content";
import { getCategories, getClassrooms, getSchoolCatalog, getSchoolContext } from "@/lib/school/queries";
import { addDays, todayInZone } from "@/lib/time";

export const metadata = { title: "New standing order" };

export default async function NewStandingOrderPage({ searchParams }: PageProps<"/school/standing-orders/new">) {
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx || ctx.role !== "school_admin" || ctx.school.status !== "approved") notFound();
  const [rooms, catalog, categories] = await Promise.all([
    getClassrooms(ctx.school.id),
    getSchoolCatalog(),
    getCategories(),
  ]);
  if (rooms.length === 0) notFound();
  const wanted = String((await searchParams).classroom ?? "");
  const room = rooms.find((r) => r.id === wanted) ?? rooms[0]!;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle sub={c.text("school.standing.new_subtitle")}>{c.text("school.standing.new")}</PageTitle>
      <Panel>
        <StandingOrderForm
          copy={c.group("school.")}
          initial={emptyStandingOrder(room.id, addDays(todayInZone("America/Los_Angeles"), 1))}
          classrooms={rooms}
          catalog={catalog}
          categories={categories}
        />
      </Panel>
    </div>
  );
}
