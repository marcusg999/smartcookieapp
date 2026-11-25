import { notFound } from "next/navigation";

import { PageTitle, Panel } from "@/components/family/kit";
import { StandingOrderForm } from "@/components/school/standing-order-form";
import { getContent } from "@/lib/content/content";
import {
  getCategories,
  getClassrooms,
  getSchoolCatalog,
  getSchoolContext,
  getStandingOrders,
} from "@/lib/school/queries";

export const metadata = { title: "Standing order" };

export default async function EditStandingOrderPage({ params }: PageProps<"/school/standing-orders/[id]">) {
  const { id } = await params;
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx || ctx.role !== "school_admin") notFound();
  const [orders, rooms, catalog, categories] = await Promise.all([
    getStandingOrders(ctx.school.id),
    getClassrooms(ctx.school.id),
    getSchoolCatalog(),
    getCategories(),
  ]);
  const so = orders.find((o) => o.id === id);
  if (!so) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle sub={c.text("school.standing.edit_subtitle")}>{so.name}</PageTitle>
      <Panel>
        <StandingOrderForm
          copy={c.group("school.")}
          initial={{ ...so, classroom_id: so.classroom_id ?? rooms[0]?.id ?? "", notes: so.notes ?? "" }}
          classrooms={rooms}
          catalog={catalog}
          categories={categories}
        />
      </Panel>
    </div>
  );
}
