import { notFound } from "next/navigation";

import { PageHeader, StatusPill } from "@/components/admin/page-header";
import { loadCatalog } from "@/lib/admin/catalog";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatDay } from "@/lib/time";

import { WeekBuilder } from "./week-builder";

export const metadata = { title: "Week builder" };

export default async function WeekPage({ params }: PageProps<"/admin/menu/weeks/[id]">) {
  await requireStaffAAL2(["owner"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: week }, { data: items }, catalog, { data: templates }, { data: settings }, { data: defaultCutoff }] =
    await Promise.all([
      supabase.from("menu_weeks").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("menu_week_items")
        .select("menu_item_id, price_override_cents, capacity, available_for")
        .eq("menu_week_id", id)
        .order("sort_order"),
      loadCatalog(),
      supabase.from("menu_templates").select("id, name").is("archived_at", null).order("name"),
      supabase
        .from("site_settings")
        .select("timezone, default_cutoff_days_before, default_cutoff_time")
        .eq("id", true)
        .single(),
      supabase.rpc("menu_week_cutoff", { p_week: id }),
    ]);
  if (!week) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title={`Week of ${formatDay(week.week_start, { month: "long", day: "numeric", year: "numeric" })}`}
        description={
          <span className="inline-flex items-center gap-2">
            Status: <StatusPill status={week.status} />
          </span>
        }
      />
      <WeekBuilder
        week={{
          id: week.id,
          week_start: week.week_start,
          status: week.status,
          delivery_dates: week.delivery_dates,
          ordering_opens_at: week.ordering_opens_at,
          cutoff_at: week.cutoff_at,
          notes_to_families: week.notes_to_families ?? "",
        }}
        items={(items ?? []) as never}
        catalog={catalog}
        templates={templates ?? []}
        timezone={settings?.timezone ?? "America/Los_Angeles"}
        effectiveCutoff={(defaultCutoff as string | null) ?? null}
      />
    </div>
  );
}
