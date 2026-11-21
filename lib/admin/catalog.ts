import "server-only";

import type { CatalogItem } from "@/components/admin/menu/item-list-builder";
import { createClient } from "@/lib/supabase/server";

/** Active meals for the week/template builders. */
export async function loadCatalog(): Promise<CatalogItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("menu_items")
    .select(
      "id, name, base_price_cents, menu_categories(name), menu_item_images(storage_path, is_primary), menu_item_allergens(allergen_id)",
    )
    .is("archived_at", null)
    .eq("is_active", true)
    .order("name");
  type Row = {
    id: string;
    name: string;
    base_price_cents: number;
    menu_categories: { name: string } | null;
    menu_item_images: { storage_path: string; is_primary: boolean }[];
    menu_item_allergens: { allergen_id: string }[];
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    base_price_cents: r.base_price_cents,
    category: r.menu_categories?.name ?? null,
    image: (r.menu_item_images.find((i) => i.is_primary) ?? r.menu_item_images[0])?.storage_path ?? null,
    allergen_count: r.menu_item_allergens.length,
  }));
}
