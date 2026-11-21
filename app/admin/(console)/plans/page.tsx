import { Plus } from "lucide-react";
import Link from "next/link";

import { formatCents } from "@/components/admin/fields";
import { EmptyState, PageHeader, StatusPill } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Plans" };

const EVERY = { week: "week", two_weeks: "2 weeks", month: "month" } as const;

export default async function PlansPage() {
  await requireStaffAAL2(["owner"]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("id, name, audience, billing_interval, meals_per_interval, allowance_unit, price_cents, is_active, subscriptions(count)")
    .is("archived_at", null)
    .order("sort_order");
  type Row = { id: string; name: string; audience: string; billing_interval: keyof typeof EVERY; meals_per_interval: number; allowance_unit: string; price_cents: number; is_active: boolean; subscriptions: { count: number }[] };
  const plans = (data ?? []) as unknown as Row[];
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Plans"
        description="Subscription plans families (or schools) can sign up for. You can invent any plan here; no developer needed."
        actions={<Button asChild><Link href="/admin/plans/new"><Plus aria-hidden="true" /> New plan</Link></Button>}
      />
      {plans.length === 0 ? (
        <EmptyState title="No plans yet" body="Create a plan like “3 lunches a week per child”." />
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/plans/${p.id}`} className="flex flex-col gap-2 rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink-sm hover:-translate-y-0.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-bold">{p.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCents(p.price_cents)} every {EVERY[p.billing_interval]} · {p.meals_per_interval} meals {p.allowance_unit === "per_child" ? "per child" : "per household"} ·{" "}
                    {p.subscriptions[0]?.count ?? 0} subscribers
                  </p>
                </div>
                <StatusPill status={p.is_active ? "active" : "archived"} label={p.is_active ? "Open for sign-ups" : "Closed to new sign-ups"} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
