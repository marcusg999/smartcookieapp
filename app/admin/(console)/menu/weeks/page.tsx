import Link from "next/link";

import { EmptyState, PageHeader, StatusPill } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatInZone } from "@/lib/time";

import { WeeksToolbar } from "./weeks-toolbar";

export const metadata = { title: "Weekly menus" };

export default async function WeeksPage() {
  await requireStaffAAL2(["owner"]);
  const supabase = await createClient();
  const [{ data: weeks }, { data: settings }] = await Promise.all([
    supabase
      .from("menu_weeks")
      .select("id, week_start, status, cutoff_at, menu_week_items(count), menu_templates(name)")
      .order("week_start", { ascending: false })
      .limit(30),
    supabase.from("site_settings").select("timezone").eq("id", true).single(),
  ]);
  const tz = settings?.timezone ?? "America/Los_Angeles";
  type Row = {
    id: string;
    week_start: string;
    status: string;
    cutoff_at: string | null;
    menu_week_items: { count: number }[];
    menu_templates: { name: string } | null;
  };
  const rows = (weeks ?? []) as unknown as Row[];
  const cutoffs = await Promise.all(
    rows.map((w) => supabase.rpc("menu_week_cutoff", { p_week: w.id }).then((r) => r.data as string | null)),
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Weekly menus"
        description="Each week has its own menu, delivery days and ordering cutoff. Draft weeks are only visible to you; published weeks are live for families."
        actions={<WeeksToolbar />}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No weeks yet"
          body="Create a week, or set up a template rotation to generate drafts automatically."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((w, i) => (
            <li key={w.id}>
              <Link
                href={`/admin/menu/weeks/${w.id}`}
                className="flex flex-col gap-2 rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink-sm transition-transform hover:-translate-y-0.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-lg font-bold">
                    Week of {formatDay(w.week_start, { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {w.menu_week_items[0]?.count ?? 0} meals
                    {w.menu_templates ? ` · from ${w.menu_templates.name}` : ""}
                    {cutoffs[i] ? ` · order by ${formatInZone(cutoffs[i], tz)}` : ""}
                  </p>
                </div>
                <StatusPill status={w.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
