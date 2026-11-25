import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { todayInZone } from "@/lib/time";

import { kitchenSettings, type KitchenSettings, type Line, type OpsOrder } from "./logic";

export type KitchenWeek = { id: string; week_start: string; delivery_dates: string[]; status: string; cutoff: string };

/**
 * Kitchen data, read with the staff member's own session. The database
 * functions decide what each role sees: `fulfillment_lines` has no prices or
 * contact details (kitchen too); `fulfillment_orders` answers only ops/owner.
 */
export const getKitchenWeeks = cache(async (): Promise<KitchenWeek[]> => {
  const supabase = await createClient();
  const today = todayInZone("America/Los_Angeles");
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 28 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("menu_weeks")
    .select("id, week_start, delivery_dates, status")
    .in("status", ["published", "closed", "fulfilled"])
    .gte("week_start", since)
    .order("week_start")
    .limit(10);
  const weeks = data ?? [];
  const cutoffs = await Promise.all(
    weeks.map(async (w) => ((await supabase.rpc("menu_week_cutoff", { p_week: w.id })).data as string | null) ?? ""),
  );
  return weeks.map((w, i) => ({
    id: w.id as string,
    week_start: w.week_start as string,
    delivery_dates: ((w.delivery_dates as string[]) ?? []).slice().sort(),
    status: w.status as string,
    cutoff: cutoffs[i]!,
  }));
});

/** The requested week, else the first week with a delivery day today or later, else the latest. */
export function pickKitchenWeek(
  weeks: KitchenWeek[],
  wanted: string | undefined,
  today: string,
): KitchenWeek | undefined {
  return (
    weeks.find((w) => w.id === wanted) ?? weeks.find((w) => w.delivery_dates.some((d) => d >= today)) ?? weeks.at(-1)
  );
}

export const getWeekLines = cache(async (weekId: string): Promise<Line[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fulfillment_lines", { p_week: weekId });
  if (error) throw error;
  return (data ?? []) as Line[];
});

export const getWeekOpsOrders = cache(async (weekId: string): Promise<(OpsOrder & Record<string, unknown>)[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fulfillment_orders", { p_week: weekId });
  if (error) throw error;
  return (data ?? []) as (OpsOrder & Record<string, unknown>)[];
});

export const getCapacities = cache(async (weekId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("menu_week_items")
    .select("menu_item_id, capacity, menu_items ( name )")
    .eq("menu_week_id", weekId);
  return new Map(
    (data ?? []).map((r) => [
      r.menu_item_id as string,
      {
        name: (r.menu_items as unknown as { name: string } | null)?.name ?? "",
        capacity: (r.capacity as number | null) ?? null,
      },
    ]),
  );
});

export const getKitchenSettings = cache(async (): Promise<KitchenSettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("site_settings").select("kitchen_settings").eq("id", true).maybeSingle();
  return kitchenSettings(data?.kitchen_settings);
});
