import { notFound } from "next/navigation";

import { formatCents } from "@/components/admin/fields";
import { PageHeader, StatusPill } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { SchoolEditor } from "./school-editor";

export const metadata = { title: "School" };

export default async function SchoolPage({ params }: PageProps<"/admin/schools/[id]">) {
  await requireStaffAAL2(["ops", "owner"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("organizations")
    .select("id, name, status, billing_email, billing_terms_days, tax_exempt, contact_phone, dropoff_instructions")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const [{ data: rooms }, { data: standing }, { data: invoices }] = await Promise.all([
    supabase.from("classrooms").select("id, name, teacher_name, grade, headcount, dropoff_location").eq("organization_id", id).is("archived_at", null).order("name"),
    supabase.from("standing_orders").select("id, name, status, weekdays, start_date, end_date, quantity_mode, fixed_quantity").eq("organization_id", id).order("start_date", { ascending: false }),
    supabase.from("invoices").select("id, period_start, period_end, status, total_cents, due_date").eq("organization_id", id).order("period_start", { ascending: false }).limit(24),
  ]);
  const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const card = "rounded-2xl border-2 border-ink bg-paper p-5";
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader title={o.name} description={<span className="inline-flex items-center gap-2">Status <StatusPill status={o.status} /></span>} />
      <SchoolEditor
        school={{ id: o.id, name: o.name, status: o.status, billing_email: o.billing_email ?? "", billing_terms_days: o.billing_terms_days, tax_exempt: o.tax_exempt, contact_phone: o.contact_phone ?? "", dropoff_instructions: o.dropoff_instructions ?? "" }}
        classrooms={(rooms ?? []).map((r) => ({ ...r, teacher_name: r.teacher_name ?? "", grade: r.grade ?? "", dropoff_location: r.dropoff_location ?? "" }))}
      />
      <section className={card} aria-labelledby="standing">
        <h2 id="standing" className="mb-3 text-xl font-bold">Standing orders</h2>
        {(standing ?? []).length === 0 ? <p className="text-muted-foreground">No standing orders yet.</p> : (
          <ul className="space-y-2">
            {(standing ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status={s.status === "active" ? "active" : "draft"} label={s.status} />
                <span className="font-semibold">{s.name}</span>
                <span className="text-sm text-muted-foreground">{(s.weekdays as number[]).map((d) => DAYS[d]).join(", ")} · from {s.start_date}{s.end_date ? ` to ${s.end_date}` : ""} · {s.quantity_mode === "fixed" ? `${s.fixed_quantity} meals` : "per headcount"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={card} aria-labelledby="invoices">
        <h2 id="invoices" className="mb-3 text-xl font-bold">Invoices</h2>
        {(invoices ?? []).length === 0 ? <p className="text-muted-foreground">No invoices yet. Monthly invoices appear here once billing runs.</p> : (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b-2 border-ink"><th className="py-2">Period</th><th>Due</th><th>Status</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {(invoices ?? []).map((i) => (
                <tr key={i.id} className="border-b border-ink/10"><td className="py-2">{i.period_start} – {i.period_end}</td><td>{i.due_date ?? "—"}</td><td><StatusPill status={i.status === "paid" ? "approved" : "pending"} label={i.status} /></td><td className="text-right">{formatCents(i.total_cents)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
