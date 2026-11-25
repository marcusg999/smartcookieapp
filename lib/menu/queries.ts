import "server-only";

import { unstable_cache } from "next/cache";

import { TAGS } from "@/lib/content/content";
import { createPublicClient } from "@/lib/supabase/public";
import { addDays, todayInZone } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

import type { RichNode } from "@/lib/validation/rich-text";

export type PublicMeal = {
  id: string;
  name: string;
  slug: string;
  short_description: string | null;
  description_rich: RichNode | null;
  price_cents: number;
  is_snack: boolean;
  category: string | null;
  badges: string[];
  contains: string[];
  may_contain: string[];
  image: { path: string; alt: string } | null;
  available_for: "families" | "schools" | "both";
};

export type PublicWeek = {
  id: string;
  week_start: string;
  status: string;
  delivery_dates: string[];
  cutoff: string | null;
  ordering_opens_at: string | null;
  notes_to_families: string | null;
  meals: PublicMeal[];
};

const WEEK_SELECT = `
  id, week_start, status, delivery_dates, ordering_opens_at, notes_to_families,
  menu_week_items ( price_override_cents, sort_order, available_for,
    menu_items ( id, name, slug, short_description, description_rich, base_price_cents, is_snack,
      menu_categories ( name ),
      menu_item_images ( storage_path, alt_text, is_primary, sort_order ),
      menu_item_badges ( dietary_badges ( name, sort_order ) ),
      menu_item_allergens ( presence, allergens ( name, sort_order ) ) ) )`;

type Row = {
  id: string;
  week_start: string;
  status: string;
  delivery_dates: string[];
  ordering_opens_at: string | null;
  notes_to_families: string | null;
  menu_week_items: {
    price_override_cents: number | null;
    sort_order: number;
    available_for: PublicMeal["available_for"];
    menu_items: {
      id: string;
      name: string;
      slug: string;
      short_description: string | null;
      description_rich: RichNode | null;
      base_price_cents: number;
      is_snack: boolean;
      menu_categories: { name: string } | null;
      menu_item_images: { storage_path: string; alt_text: string; is_primary: boolean; sort_order: number }[];
      menu_item_badges: { dietary_badges: { name: string; sort_order: number } | null }[];
      menu_item_allergens: {
        presence: "contains" | "may_contain";
        allergens: { name: string; sort_order: number } | null;
      }[];
    } | null;
  }[];
};

function shape(row: Row, cutoff: string | null): PublicWeek {
  const meals = row.menu_week_items
    .filter((wi) => wi.menu_items)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((wi): PublicMeal => {
      const m = wi.menu_items!;
      const images = [...m.menu_item_images].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order,
      );
      const allergens = [...m.menu_item_allergens]
        .filter((a) => a.allergens)
        .sort((a, b) => a.allergens!.sort_order - b.allergens!.sort_order);
      return {
        id: m.id,
        name: m.name,
        slug: m.slug,
        short_description: m.short_description,
        description_rich: m.description_rich,
        price_cents: wi.price_override_cents ?? m.base_price_cents,
        is_snack: m.is_snack,
        category: m.menu_categories?.name ?? null,
        badges: m.menu_item_badges
          .map((b) => b.dietary_badges)
          .filter(Boolean)
          .sort((a, b) => a!.sort_order - b!.sort_order)
          .map((b) => b!.name),
        contains: allergens.filter((a) => a.presence === "contains").map((a) => a.allergens!.name),
        may_contain: allergens.filter((a) => a.presence === "may_contain").map((a) => a.allergens!.name),
        image: images[0] ? { path: images[0].storage_path, alt: images[0].alt_text } : null,
        available_for: wi.available_for,
      };
    });
  return {
    id: row.id,
    week_start: row.week_start,
    status: row.status,
    delivery_dates: row.delivery_dates,
    cutoff,
    ordering_opens_at: row.ordering_opens_at,
    notes_to_families: row.notes_to_families,
    meals,
  };
}

/**
 * Published weeks that aren't over yet (last delivery day today or later, in
 * the business timezone), soonest first. Cached; revalidated when the menu changes.
 */
export const getPublishedWeeks = unstable_cache(
  async (): Promise<PublicWeek[]> => {
    const supabase = createPublicClient();
    const { data: settings } = await supabase.from("site_settings_public").select("timezone").single();
    const today = todayInZone(settings?.timezone ?? "America/Los_Angeles");
    const { data, error } = await supabase
      .from("menu_weeks")
      .select(WEEK_SELECT)
      // Weeks close automatically at cutoff (Phase 8); a closed week is still
      // this week's menu until its last delivery day.
      .in("status", ["published", "closed"])
      .gte("week_start", addDays(today, -6))
      .order("week_start")
      .limit(8);
    if (error) throw new Error(`menu fetch failed: ${error.code}`);
    const rows = ((data ?? []) as unknown as Row[]).filter((row) => {
      const last = [...row.delivery_dates].sort().at(-1) ?? addDays(row.week_start, 6);
      return last >= today;
    });
    return Promise.all(
      rows.slice(0, 6).map(async (row) => {
        const { data: cutoff } = await supabase.rpc("menu_week_cutoff", { p_week: row.id });
        return shape(row, (cutoff as string | null) ?? null);
      }),
    );
  },
  ["menu-published-weeks"],
  { tags: [TAGS.menu], revalidate: 600 },
);

/** Any week, read with the caller's session (owner preview of drafts). RLS decides. */
export async function getWeekForPreview(id: string): Promise<PublicWeek | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("menu_weeks").select(WEEK_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: cutoff } = await supabase.rpc("menu_week_cutoff", { p_week: id });
  return shape(data as unknown as Row, (cutoff as string | null) ?? null);
}

/** URL for a stored image, or null for built-in placeholder art (`placeholder:<key>`). */
export function imageUrl(path: string, bucket = "menu-images"): string | null {
  if (path.startsWith("placeholder:")) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
