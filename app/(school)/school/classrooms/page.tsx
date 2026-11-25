import { notFound } from "next/navigation";

import { PageTitle } from "@/components/family/kit";
import { ClassroomsManager } from "@/components/school/classrooms-manager";
import { getContent } from "@/lib/content/content";
import { getAllergens } from "@/lib/family/queries";
import { getAllergySummary, getClassrooms, getRoster, getSchoolContext } from "@/lib/school/queries";

export const metadata = { title: "Classrooms" };

export default async function SchoolClassroomsPage() {
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx) notFound();
  const orgId = ctx.school.id;
  const [classrooms, summary, roster, allergens] = await Promise.all([
    getClassrooms(orgId),
    getAllergySummary(orgId),
    getRoster(orgId),
    getAllergens(),
  ]);
  return (
    <div>
      <PageTitle sub={c.text("school.classrooms.subtitle")}>{c.text("school.classrooms.title")}</PageTitle>
      <ClassroomsManager
        copy={c.group("school.")}
        isAdmin={ctx.role === "school_admin"}
        classrooms={classrooms}
        allergens={allergens.map((a) => ({ id: a.id, name: a.name }))}
        summary={summary}
        roster={roster}
      />
    </div>
  );
}
