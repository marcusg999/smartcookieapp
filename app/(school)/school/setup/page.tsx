import { notFound } from "next/navigation";

import { PageTitle, Panel } from "@/components/family/kit";
import { SetupForm } from "@/components/school/setup-form";
import { getContent } from "@/lib/content/content";
import { getSchoolContext } from "@/lib/school/queries";

export const metadata = { title: "School details" };

export default async function SchoolSetupPage() {
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx || ctx.role !== "school_admin") notFound();
  const s = ctx.school;
  const firstTime = !s.onboarded_at;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle sub={c.text(firstTime ? "school.setup.first_subtitle" : "school.setup.subtitle")}>
        {c.text("school.setup.title")}
      </PageTitle>
      <Panel>
        <SetupForm
          copy={c.group("school.")}
          firstTime={firstTime}
          initial={{
            name: s.name,
            billing_email: s.billing_email ?? "",
            contact_phone: s.contact_phone ?? "",
            line1: s.address?.line1 ?? "",
            city: s.address?.city ?? "",
            state: s.address?.state ?? "CA",
            zip: s.address?.zip ?? "",
            dropoff_entrance: s.dropoff_entrance ?? "",
            dropoff_contact: s.dropoff_contact ?? "",
            dropoff_window: s.dropoff_window ?? "",
            dropoff_instructions: s.dropoff_instructions ?? "",
          }}
        />
      </Panel>
      <p className="mt-4 text-sm text-muted-foreground">
        {c.text("school.setup.terms", {
          terms: String(s.billing_terms_days),
          tax: c.text(s.tax_exempt ? "school.setup.tax_exempt" : "school.setup.taxable"),
        })}
      </p>
    </div>
  );
}
