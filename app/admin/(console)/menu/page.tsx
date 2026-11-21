import { Plus, Search } from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader, StatusPill } from "@/components/admin/page-header";
import { formatCents } from "@/components/admin/fields";
import { MealImage } from "@/components/menu/meal-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Menu items" };

type Item = {
  id: string;
  name: string;
  base_price_cents: number;
  is_active: boolean;
  archived_at: string | null;
  menu_categories: { name: string } | null;
  menu_item_images: { storage_path: string; alt_text: string; is_primary: boolean }[];
  menu_item_badges: { badge_id: string }[];
  menu_item_allergens: { allergen_id: string }[];
};

export default async function MenuItemsPage({ searchParams }: PageProps<"/admin/menu">) {
  await requireStaffAAL2(["owner"]);
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const category = typeof params.category === "string" ? params.category : "";
  const badge = typeof params.badge === "string" ? params.badge : "";
  const view = params.view === "archived" ? "archived" : "active";

  const supabase = await createClient();
  let query = supabase
    .from("menu_items")
    .select(
      "id, name, base_price_cents, is_active, archived_at, menu_categories(name), menu_item_images(storage_path, alt_text, is_primary), menu_item_badges(badge_id), menu_item_allergens(allergen_id)",
    )
    .order("name");
  query = view === "archived" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  if (category) query = query.eq("category_id", category);
  const [{ data }, { data: categories }, { data: badges }] = await Promise.all([
    query,
    supabase.from("menu_categories").select("id, name").order("sort_order"),
    supabase.from("dietary_badges").select("id, name").is("archived_at", null).order("sort_order"),
  ]);
  let items = (data ?? []) as unknown as Item[];
  if (badge) items = items.filter((i) => i.menu_item_badges.some((b) => b.badge_id === badge));

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Menu items"
        description="Every meal you can put on a weekly menu. Changes to names, photos and allergens show on the site right away; price changes apply to new orders."
        actions={
          <Button asChild>
            <Link href="/admin/menu/new">
              <Plus aria-hidden="true" /> New meal
            </Link>
          </Button>
        }
      />

      <form
        className="mb-6 grid gap-3 rounded-2xl border-2 border-ink bg-paper p-4 sm:grid-cols-[1fr_auto_auto_auto_auto]"
        role="search"
      >
        <label className="relative">
          <span className="sr-only">Search meals</span>
          <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input name="q" defaultValue={q} placeholder="Search meals" className="pl-9" />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select
            name="category"
            defaultValue={category}
            className="h-11 w-full rounded-md border-2 border-ink bg-card px-3"
          >
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Badge</span>
          <select name="badge" defaultValue={badge} className="h-11 w-full rounded-md border-2 border-ink bg-card px-3">
            <option value="">Any badge</option>
            {(badges ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Show</span>
          <select name="view" defaultValue={view} className="h-11 w-full rounded-md border-2 border-ink bg-card px-3">
            <option value="active">Current meals</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title={q || category || badge ? "No meals match" : view === "archived" ? "Nothing archived" : "No meals yet"}
          body={
            view === "archived"
              ? "Archived meals appear here so you can restore them."
              : "Add your first meal, then put it on a weekly menu."
          }
          action={
            view === "active" ? (
              <Button asChild>
                <Link href="/admin/menu/new">Add a meal</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const img = item.menu_item_images.find((i) => i.is_primary) ?? item.menu_item_images[0];
            return (
              <li key={item.id}>
                <Link
                  href={`/admin/menu/${item.id}`}
                  className="group flex h-full gap-3 rounded-2xl border-2 border-ink bg-paper p-3 shadow-ink-sm transition-transform hover:-translate-y-0.5"
                >
                  <MealImage
                    path={img?.storage_path}
                    alt={img?.alt_text ?? item.name}
                    className="size-20 shrink-0 rounded-xl border-2 border-ink"
                    sizes="80px"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold group-hover:underline">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.menu_categories?.name ?? "No category"} · {formatCents(item.base_price_cents)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <StatusPill
                        status={item.archived_at ? "archived" : item.is_active ? "active" : "draft"}
                        label={item.archived_at ? "Archived" : item.is_active ? "On" : "Off"}
                      />
                      {item.menu_item_allergens.length === 0 ? (
                        <span className="rounded-full border-2 border-allergy px-2 py-0.5 text-xs font-bold text-allergy">
                          No allergens set
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
