import Link from "next/link";

import { formatCents } from "@/lib/money";
import { EmptyState, PageHeader } from "@/components/admin/page-header";
import { Input } from "@/components/ui/input";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requireStaffAAL2(["ops", "owner"]);
  const q = String((await searchParams).q ?? "")
    .trim()
    .slice(0, 80);
  const supabase = await createClient();
  let query = supabase
    .from("households")
    .select("id, name, created_at, children(id, archived_at), orders(total_cents, status), subscriptions(status)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (q) query = query.ilike("name", `%${q.replace(/[%_,()]/g, "")}%`);
  const { data: households } = await query;
  const rows = (households ?? []).map((h) => ({
    ...h,
    kids: (h.children ?? []).filter((c: { archived_at: string | null }) => !c.archived_at).length,
    ltv: (h.orders ?? [])
      .filter((o: { status: string }) => ["paid", "fulfilled", "invoiced", "partially_refunded"].includes(o.status))
      .reduce((s: number, o: { total_cents: number }) => s + o.total_cents, 0),
    subscribed: (h.subscriptions ?? []).some((s: { status: string }) =>
      ["active", "trialing", "past_due"].includes(s.status),
    ),
  }));
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Customers"
        description="Families, their children (with allergies), orders and subscriptions."
      />
      <form className="mb-4 flex gap-2" role="search">
        <label className="flex-1">
          <span className="sr-only">Search households</span>
          <Input name="q" defaultValue={q} placeholder="Search by household name" />
        </label>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title={q ? "No matches" : "No families yet"}
          body={q ? "Try a different name." : "Families appear here once they sign up."}
        />
      ) : (
        <ul className="divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-paper">
          {rows.map((h) => (
            <li key={h.id}>
              <Link
                href={`/admin/customers/${h.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-orange/30 focus-visible:bg-orange/30"
              >
                <span className="font-semibold">{h.name}</span>
                <span className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span>
                    {h.kids} {h.kids === 1 ? "child" : "children"}
                  </span>
                  <span>{formatCents(h.ltv)} lifetime</span>
                  {h.subscribed ? <span className="font-semibold text-ink">Subscriber</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
