import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { MenuItemEditor, type EditorItem } from "./menu-item-editor";

export const metadata = { title: "Edit meal" };

export default async function MenuItemPage({ params }: PageProps<"/admin/menu/[id]">) {
  await requireStaffAAL2(["owner"]);
  const { id } = await params;
  const supabase = await createClient();
  const isNew = id === "new";

  const [itemRes, imagesRes, categories, badges, allergens, history] = await Promise.all([
    isNew
      ? Promise.resolve({ data: null })
      : supabase
          .from("menu_items")
          .select("*, menu_item_badges(badge_id), menu_item_allergens(allergen_id, presence)")
          .eq("id", id)
          .maybeSingle(),
    isNew
      ? Promise.resolve({ data: [] })
      : supabase
          .from("menu_item_images")
          .select("id, storage_path, alt_text, is_primary, sort_order")
          .eq("menu_item_id", id)
          .order("sort_order"),
    supabase.from("menu_categories").select("id, name").order("sort_order"),
    supabase.from("dietary_badges").select("id, name").is("archived_at", null).order("sort_order"),
    supabase.from("allergens").select("id, name, is_top9").is("archived_at", null).order("sort_order"),
    isNew
      ? Promise.resolve({ data: [] })
      : supabase
          .from("menu_item_price_history")
          .select("base_price_cents, school_price_cents, active_from")
          .eq("menu_item_id", id)
          .order("active_from", { ascending: false })
          .limit(5),
  ]);
  if (!isNew && !itemRes.data) notFound();
  const raw = itemRes.data as
    | (Record<string, unknown> & {
        menu_item_badges: { badge_id: string }[];
        menu_item_allergens: { allergen_id: string; presence: "contains" | "may_contain" }[];
      })
    | null;

  const item: EditorItem = raw
    ? {
        id: raw.id as string,
        name: raw.name as string,
        short_description: (raw.short_description as string) ?? "",
        description_rich: (raw.description_rich as EditorItem["description_rich"]) ?? null,
        category_id: (raw.category_id as string) ?? null,
        base_price_cents: raw.base_price_cents as number,
        school_price_cents: (raw.school_price_cents as number | null) ?? null,
        portion_label: (raw.portion_label as string) ?? "",
        ingredients: (raw.ingredients as string) ?? "",
        nutrition: Object.entries((raw.nutrition as Record<string, unknown>) ?? {}).map(([label, value]) => ({
          label,
          value: String(value),
        })),
        is_snack: Boolean(raw.is_snack),
        is_active: Boolean(raw.is_active),
        archived: Boolean(raw.archived_at),
        badge_ids: raw.menu_item_badges.map((b) => b.badge_id),
        allergens: raw.menu_item_allergens,
        images: (imagesRes.data ?? []) as EditorItem["images"],
        stripe_price_id: (raw.stripe_price_id as string | null) ?? null,
      }
    : {
        name: "",
        short_description: "",
        description_rich: null,
        category_id: null,
        base_price_cents: 0,
        school_price_cents: null,
        portion_label: "Kid size",
        ingredients: "",
        nutrition: [],
        is_snack: false,
        is_active: true,
        archived: false,
        badge_ids: [],
        allergens: [],
        images: [],
        stripe_price_id: null,
      };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title={isNew ? "New meal" : item.name}
        description={
          isNew
            ? "Fill in the details, then save. You can add photos after the first save."
            : "Changes to the price need your authenticator code and apply to new orders only."
        }
      />
      <MenuItemEditor
        item={item}
        categories={categories.data ?? []}
        badges={badges.data ?? []}
        allergens={allergens.data ?? []}
        priceHistory={
          (history.data ?? []) as { base_price_cents: number; school_price_cents: number | null; active_from: string }[]
        }
      />
    </div>
  );
}
