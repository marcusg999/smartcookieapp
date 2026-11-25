import { notFound } from "next/navigation";

import { PageHeader, StatusPill } from "@/components/admin/page-header";
import { StepUpProvider } from "@/components/mfa/step-up";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { INVOICE_COLUMNS, type Invoice, type StandingOrder } from "@/lib/school/queries";
import { getCategories, getSchoolCatalog } from "@/lib/school/queries";
import { createClient } from "@/lib/supabase/server";
import { todayInZone } from "@/lib/time";

import { SchoolEditor } from "./school-editor";
import { AdminInvoices, AdminStandingOrders, PricingAndPlanning } from "./school-tools";

export const metadata = { title: "School" };

export default async function SchoolPage({ params }: PageProps<"/admin/schools/[id]">) {
  const user = await requireStaffAAL2(["ops", "owner"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("organizations")
    .select(
      "id, name, status, billing_email, billing_terms_days, tax_exempt, use_school_pricing, contact_phone, dropoff_instructions, dropoff_entrance, dropoff_contact, dropoff_window, address, onboarded_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const [{ data: rooms }, { data: standing }, { data: invoices }, { data: factors }, c, catalog, categories] =
    await Promise.all([
      supabase
        .from("classrooms")
        .select("id, name, teacher_name, grade, headcount, dropoff_location")
        .eq("organization_id", id)
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("standing_orders")
        .select(
          "id, classroom_id, name, weekdays, start_date, end_date, status, quantity_mode, fixed_quantity, buffer_percent, menu_selection_mode, day_items, rotation, notes",
        )
        .eq("organization_id", id)
        .order("start_date", { ascending: false }),
      supabase
        .from("invoices")
        .select(INVOICE_COLUMNS)
        .eq("organization_id", id)
        .order("created_at", { ascending: false })
        .limit(36),
      supabase.auth.mfa.listFactors(),
      getContent(),
      getSchoolCatalog(),
      getCategories(),
    ]);
  const factorId = factors?.totp.find((f) => f.status === "verified")?.id ?? null;
  const addr = o.address as { line1?: string; city?: string; state?: string; zip?: string } | null;
  const isOwner = user.roles.includes("owner");
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title={o.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Status <StatusPill status={o.status} />
            {o.onboarded_at ? null : <span className="text-sm">· hasn&apos;t finished setup yet</span>}
          </span>
        }
      />
      <StepUpProvider factorId={factorId}>
        <section className="rounded-2xl border-2 border-ink bg-paper p-5 text-sm" aria-labelledby="dropoff">
          <h2 id="dropoff" className="mb-2 text-xl font-bold">
            Drop-off (from the school)
          </h2>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <dt className="font-semibold">Address</dt>
            <dd>{addr?.line1 ? `${addr.line1}, ${addr.city ?? ""} ${addr.state ?? ""} ${addr.zip ?? ""}` : "—"}</dd>
            <dt className="font-semibold">Entrance</dt>
            <dd>{o.dropoff_entrance ?? "—"}</dd>
            <dt className="font-semibold">Contact</dt>
            <dd>{o.dropoff_contact ?? "—"}</dd>
            <dt className="font-semibold">Time window</dt>
            <dd>{o.dropoff_window ?? "—"}</dd>
          </dl>
        </section>
        <SchoolEditor
          school={{
            id: o.id,
            name: o.name,
            status: o.status,
            billing_email: o.billing_email ?? "",
            billing_terms_days: o.billing_terms_days,
            tax_exempt: o.tax_exempt,
            contact_phone: o.contact_phone ?? "",
            dropoff_instructions: o.dropoff_instructions ?? "",
          }}
          classrooms={(rooms ?? []).map((r) => ({
            ...r,
            teacher_name: r.teacher_name ?? "",
            grade: r.grade ?? "",
            dropoff_location: r.dropoff_location ?? "",
          }))}
        />
        <PricingAndPlanning orgId={o.id} useSchoolPricing={o.use_school_pricing} isOwner={isOwner} />
        <AdminStandingOrders
          orgId={o.id}
          copy={c.group("school.")}
          orders={(standing ?? []) as StandingOrder[]}
          classrooms={rooms ?? []}
          catalog={catalog}
          categories={categories}
        />
        <AdminInvoices
          orgId={o.id}
          invoices={(invoices ?? []) as Invoice[]}
          isOwner={isOwner}
          today={todayInZone("America/Los_Angeles")}
        />
      </StepUpProvider>
    </div>
  );
}
