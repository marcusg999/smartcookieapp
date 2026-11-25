import { notFound } from "next/navigation";

import { PageTitle } from "@/components/family/kit";
import { CalendarManager } from "@/components/school/calendar-manager";
import { getContent } from "@/lib/content/content";
import { getClosures, getSchoolContext } from "@/lib/school/queries";
import { todayInZone } from "@/lib/time";

export const metadata = { title: "School calendar" };

export default async function SchoolCalendarPage() {
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx) notFound();
  const closures = await getClosures(ctx.school.id);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle sub={c.text("school.calendar.subtitle")}>{c.text("school.calendar.title")}</PageTitle>
      <CalendarManager
        copy={c.group("school.")}
        closures={closures}
        isAdmin={ctx.role === "school_admin" && ctx.school.status === "approved"}
        minDate={todayInZone("America/Los_Angeles")}
      />
    </div>
  );
}
