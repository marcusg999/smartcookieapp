import Link from "next/link";

import { EmptyState, PageHeader, StatusPill } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Schools" };

const FILTERS = ["all", "pending", "approved", "suspended", "rejected"] as const;

export default async function AdminSchoolsPage({ searchParams }: PageProps<"/admin/schools">) {
  await requireStaffAAL2(["ops", "owner"]);
  const raw = String((await searchParams).status ?? "all");
  const status = (FILTERS as readonly string[]).includes(raw) ? raw : "all";
  const supabase = await createClient();
  let q = supabase
    .from("organizations")
    .select("id, name, type, status, created_at, classrooms(headcount, archived_at)")
    .is("archived_at", null)
    .order("status")
    .order("name");
  if (status !== "all") q = q.eq("status", status);
  const [{ data: orgs }, { data: aging }] = await Promise.all([q, supabase.rpc("ar_aging")]);
  type Aging = {
    organization_id: string;
    name: string;
    current_cents: number;
    days_1_30_cents: number;
    days_31_60_cents: number;
    days_60_plus_cents: number;
    total_cents: number;
  };
  const rows = (aging ?? []) as Aging[];
  const sum = (k: keyof Aging) => rows.reduce((s, r) => s + Number(r[k]), 0);
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Schools" description="Approve new schools, set billing terms, and manage classrooms." />
      <section className="mb-6 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="aging">
        <h2 id="aging" className="mb-1 text-xl font-bold">
          Accounts receivable
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">Unpaid school invoices by how long they&apos;re past due.</p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">Nothing outstanding.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th className="py-2">School</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">1–30 days</th>
                  <th className="text-right">31–60 days</th>
                  <th className="text-right">60+ days</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.organization_id} className="border-b border-ink/10">
                    <td className="py-2">
                      <Link href={`/admin/schools/${r.organization_id}`} className="font-semibold underline">
                        {r.name}
                      </Link>
                      {Number(r.days_1_30_cents) + Number(r.days_31_60_cents) + Number(r.days_60_plus_cents) > 0 ? (
                        <span className="ml-2 rounded-full border-2 border-allergy px-1.5 text-xs font-bold text-allergy">
                          overdue
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right">{formatCents(Number(r.current_cents))}</td>
                    <td className="text-right">{formatCents(Number(r.days_1_30_cents))}</td>
                    <td className="text-right">{formatCents(Number(r.days_31_60_cents))}</td>
                    <td className="text-right font-semibold">{formatCents(Number(r.days_60_plus_cents))}</td>
                    <td className="text-right font-bold">{formatCents(Number(r.total_cents))}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-2">All schools</td>
                  <td className="text-right">{formatCents(sum("current_cents"))}</td>
                  <td className="text-right">{formatCents(sum("days_1_30_cents"))}</td>
                  <td className="text-right">{formatCents(sum("days_31_60_cents"))}</td>
                  <td className="text-right">{formatCents(sum("days_60_plus_cents"))}</td>
                  <td className="text-right">{formatCents(sum("total_cents"))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
      <nav aria-label="Filter schools" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/admin/schools" : `/admin/schools?status=${f}`}
            aria-current={f === status ? "page" : undefined}
            className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold capitalize ${f === status ? "bg-orange" : "bg-paper"}`}
          >
            {f}
          </Link>
        ))}
      </nav>
      {(orgs ?? []).length === 0 ? (
        <EmptyState title="No schools here" body="Schools appear when they apply through the school sign-up." />
      ) : (
        <ul className="divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-paper">
          {(orgs ?? []).map((o) => {
            const rooms = (o.classrooms ?? []).filter((c: { archived_at: string | null }) => !c.archived_at);
            const kids = rooms.reduce((s: number, c: { headcount: number }) => s + c.headcount, 0);
            return (
              <li key={o.id}>
                <Link
                  href={`/admin/schools/${o.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-orange/30"
                >
                  <span className="font-semibold">{o.name}</span>
                  <span className="flex items-center gap-3 text-sm text-muted-foreground">
                    {rooms.length} classrooms · {kids} students <StatusPill status={o.status} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
