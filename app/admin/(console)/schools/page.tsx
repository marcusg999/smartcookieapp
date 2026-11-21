import Link from "next/link";

import { EmptyState, PageHeader, StatusPill } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Schools" };

const FILTERS = ["all", "pending", "approved", "suspended", "rejected"] as const;

export default async function AdminSchoolsPage({ searchParams }: PageProps<"/admin/schools">) {
  await requireStaffAAL2(["ops", "owner"]);
  const raw = String((await searchParams).status ?? "all");
  const status = (FILTERS as readonly string[]).includes(raw) ? raw : "all";
  const supabase = await createClient();
  let q = supabase.from("organizations").select("id, name, type, status, created_at, classrooms(headcount, archived_at)").is("archived_at", null).order("status").order("name");
  if (status !== "all") q = q.eq("status", status);
  const { data: orgs } = await q;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Schools" description="Approve new schools, set billing terms, and manage classrooms." />
      <nav aria-label="Filter schools" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={f === "all" ? "/admin/schools" : `/admin/schools?status=${f}`} aria-current={f === status ? "page" : undefined}
            className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold capitalize ${f === status ? "bg-orange" : "bg-paper"}`}>{f}</Link>
        ))}
      </nav>
      {(orgs ?? []).length === 0 ? <EmptyState title="No schools here" body="Schools appear when they apply through the school sign-up." /> : (
        <ul className="divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-paper">
          {(orgs ?? []).map((o) => {
            const rooms = (o.classrooms ?? []).filter((c: { archived_at: string | null }) => !c.archived_at);
            const kids = rooms.reduce((s: number, c: { headcount: number }) => s + c.headcount, 0);
            return (
              <li key={o.id}>
                <Link href={`/admin/schools/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-orange/30">
                  <span className="font-semibold">{o.name}</span>
                  <span className="flex items-center gap-3 text-sm text-muted-foreground">{rooms.length} classrooms · {kids} students <StatusPill status={o.status} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
