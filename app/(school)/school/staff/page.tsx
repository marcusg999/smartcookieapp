import { notFound } from "next/navigation";

import { PageTitle } from "@/components/family/kit";
import { StaffManager } from "@/components/school/staff-manager";
import { getContent } from "@/lib/content/content";
import { getMembers, getSchoolContext } from "@/lib/school/queries";

export const metadata = { title: "School staff" };

export default async function SchoolStaffPage() {
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx || ctx.role !== "school_admin") notFound();
  const members = await getMembers(ctx.school.id);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle sub={c.text("school.staff.subtitle")}>{c.text("school.staff.title")}</PageTitle>
      <StaffManager copy={c.group("school.")} members={members} canInvite={ctx.school.status === "approved"} />
    </div>
  );
}
