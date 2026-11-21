"use client";

import { ArrowDown, ArrowUp, GripVertical, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { MoneyInput } from "@/components/admin/fields";
import { MealImage } from "@/components/menu/meal-image";
import { Input } from "@/components/ui/input";

export type BuilderItem = {
  menu_item_id: string;
  price_override_cents: number | null;
  capacity: number | null;
  available_for: "families" | "schools" | "both";
};

export type CatalogItem = {
  id: string;
  name: string;
  base_price_cents: number;
  category: string | null;
  image: string | null;
  allergen_count: number;
};

/**
 * The list of meals on a week or template: drag (or use the arrow buttons)
 * to reorder, set per-meal price overrides, capacity and who can order it.
 */
export function ItemListBuilder({
  items,
  onChange,
  catalog,
}: {
  items: BuilderItem[];
  onChange: (items: BuilderItem[]) => void;
  catalog: CatalogItem[];
}) {
  const [q, setQ] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const onWeek = new Set(items.map((i) => i.menu_item_id));
  const available = catalog.filter((c) => !onWeek.has(c.id) && c.name.toLowerCase().includes(q.toLowerCase()));

  const update = (i: number, patch: Partial<BuilderItem>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    onChange(next);
  };
  const add = (id: string) =>
    onChange([...items, { menu_item_id: id, price_override_cents: null, capacity: null, available_for: "both" }]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div>
        <h3 className="mb-2 font-bold">On this menu ({items.length})</h3>
        {items.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-ink/50 p-6 text-center text-muted-foreground">
            No meals yet. Add meals from the list, or apply a template.
          </p>
        ) : (
          <ol className="space-y-2">
            {items.map((it, i) => {
              const meal = byId.get(it.menu_item_id);
              return (
                <li
                  key={it.menu_item_id}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) move(dragIndex, i);
                    setDragIndex(null);
                  }}
                  className={`rounded-xl border-2 border-ink bg-card p-3 ${dragIndex === i ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <GripVertical aria-hidden="true" className="size-5 shrink-0 cursor-grab text-muted-foreground" />
                    <MealImage
                      path={meal?.image}
                      alt=""
                      className="size-12 shrink-0 rounded-lg border-2 border-ink"
                      sizes="48px"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{meal?.name ?? "Unknown meal"}</p>
                      {meal && meal.allergen_count === 0 ? (
                        <p className="text-xs font-bold text-allergy">No allergens recorded</p>
                      ) : null}
                    </div>
                    <div className="flex">
                      <button
                        type="button"
                        className="rounded p-2 hover:bg-ink/10 disabled:opacity-30"
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                        aria-label={`Move ${meal?.name} up`}
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-2 hover:bg-ink/10 disabled:opacity-30"
                        disabled={i === items.length - 1}
                        onClick={() => move(i, i + 1)}
                        aria-label={`Move ${meal?.name} down`}
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-2 hover:bg-ink/10"
                        onClick={() => onChange(items.filter((_, j) => j !== i))}
                        aria-label={`Remove ${meal?.name}`}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 pl-8 sm:grid-cols-3">
                    <label className="text-xs font-semibold">
                      Price this week
                      <MoneyInput
                        id={`price-${it.menu_item_id}`}
                        cents={it.price_override_cents}
                        allowEmpty
                        onChange={(v) => update(i, { price_override_cents: v })}
                      />
                      <span className="font-normal text-muted-foreground">Empty = usual price</span>
                    </label>
                    <label className="text-xs font-semibold">
                      Max servings
                      <Input
                        inputMode="numeric"
                        placeholder="No limit"
                        defaultValue={it.capacity ?? ""}
                        onChange={(e) =>
                          update(i, {
                            capacity:
                              e.target.value === "" ? null : Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      Who can order
                      <select
                        value={it.available_for}
                        onChange={(e) => update(i, { available_for: e.target.value as BuilderItem["available_for"] })}
                        className="h-11 w-full rounded-md border-2 border-ink bg-card px-2"
                      >
                        <option value="both">Families & schools</option>
                        <option value="families">Families only</option>
                        <option value="schools">Schools only</option>
                      </select>
                    </label>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <aside className="rounded-xl border-2 border-ink bg-paper p-3 lg:sticky lg:top-4 lg:self-start">
        <h3 className="mb-2 font-bold">Add meals</h3>
        <label className="relative block">
          <span className="sr-only">Search meals to add</span>
          <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-9" />
        </label>
        <ul className="mt-2 max-h-[28rem] space-y-1 overflow-y-auto">
          {available.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => add(c.id)}
                className="flex w-full items-center gap-2 rounded-lg border-2 border-transparent p-2 text-left text-sm hover:border-ink"
              >
                <Plus aria-hidden="true" className="size-4 shrink-0" />
                <span className="flex-1 truncate font-semibold">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.category}</span>
              </button>
            </li>
          ))}
          {available.length === 0 ? <li className="p-2 text-sm text-muted-foreground">Nothing else to add.</li> : null}
        </ul>
      </aside>
    </div>
  );
}
