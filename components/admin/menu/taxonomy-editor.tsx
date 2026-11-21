"use client";

import { ArrowDown, ArrowUp, Lock, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ChipToggle } from "@/components/admin/fields";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveTaxonomy } from "@/app/admin/(console)/menu/taxonomy-actions";

export type TaxRow = {
  id?: string;
  name: string;
  icon?: string;
  color?: string;
  is_active?: boolean;
  archived?: boolean;
  locked?: boolean;
};

/** Shared editor for categories, badges and allergens: rename, reorder, add, hide. */
export function TaxonomyEditor({
  kind,
  rows: initial,
  noun,
}: {
  kind: "categories" | "badges" | "allergens";
  rows: TaxRow[];
  noun: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => JSON.stringify(rows) !== saved, [rows, saved]);
  useUnsavedGuard(dirty);
  const update = (i: number, patch: Partial<TaxRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setRows(next);
  };

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {rows.map((row, i) => (
          <li
            key={row.id ?? `new-${i}`}
            className={`flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink bg-paper p-3 ${row.archived || row.is_active === false ? "opacity-60" : ""}`}
          >
            <div className="flex">
              <Button
                size="sm"
                variant="ghost"
                disabled={i === 0}
                aria-label={`Move ${row.name} up`}
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === rows.length - 1}
                aria-label={`Move ${row.name} down`}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
            <Input
              aria-label={`${noun} name`}
              className="min-w-40 flex-1"
              value={row.name}
              maxLength={60}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            {kind === "badges" ? (
              <label className="flex items-center gap-2 text-sm font-semibold">
                Colour
                <input
                  type="color"
                  value={row.color ?? "#1f3b2d"}
                  onChange={(e) => update(i, { color: e.target.value })}
                  className="h-10 w-12 cursor-pointer rounded border-2 border-ink"
                />
              </label>
            ) : null}
            {kind !== "categories" ? (
              <Input
                aria-label="Icon name"
                placeholder="Icon (optional)"
                className="w-36"
                value={row.icon ?? ""}
                onChange={(e) => update(i, { icon: e.target.value })}
              />
            ) : null}
            {row.locked ? (
              <span className="flex items-center gap-1 text-xs font-bold">
                <Lock aria-hidden="true" className="size-3.5" /> Top 9 (required)
              </span>
            ) : kind === "categories" ? (
              <ChipToggle pressed={row.is_active !== false} onPressedChange={(on) => update(i, { is_active: on })}>
                {row.is_active !== false ? "Shown" : "Hidden"}
              </ChipToggle>
            ) : (
              <ChipToggle pressed={!row.archived} onPressedChange={(on) => update(i, { archived: !on })}>
                {row.archived ? "Hidden" : "Shown"}
              </ChipToggle>
            )}
          </li>
        ))}
      </ol>
      <Button variant="outline" onClick={() => setRows([...rows, { name: "", is_active: true }])}>
        <Plus aria-hidden="true" /> Add {noun.toLowerCase()}
      </Button>
      <UnsavedBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setRows(JSON.parse(saved))}
        onSave={async () => {
          setSaving(true);
          const r = await saveTaxonomy({
            kind,
            rows: rows.filter((x) => x.name.trim()).map(({ locked: _l, ...rest }) => rest),
          });
          setSaving(false);
          if (r.ok) {
            toast.success(r.message);
            setSaved(JSON.stringify(rows));
            router.refresh();
          } else toast.error(r.message);
        }}
      />
    </div>
  );
}
