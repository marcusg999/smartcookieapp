"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteStandingOrder, saveStandingOrder } from "@/app/(school)/actions";
import { Chip } from "@/components/family/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Classroom, SchoolMenuItem } from "@/lib/school/queries";
import type { StandingOrderInput } from "@/lib/school/standing";

import { Field, fmt, selectClass, textareaClass, useRun, WEEKDAYS, type Copy } from "./kit";

export type { StandingOrderInput };

type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
/**
 * Create / edit a standing order. Saving re-plans every open week (before
 * cutoff) straight away. Used by the school admin and (with `save`) by ops.
 */
export function StandingOrderForm({
  copy,
  initial,
  classrooms,
  catalog,
  categories,
  save,
  remove,
  afterSave = "/school/standing-orders",
  allowDelete = true,
}: {
  copy: Copy;
  initial: StandingOrderInput;
  classrooms: Classroom[];
  catalog: SchoolMenuItem[];
  categories: { id: string; name: string }[];
  save?: (v: StandingOrderInput) => Promise<Result>;
  remove?: (id: string) => Promise<Result>;
  afterSave?: string | null;
  allowDelete?: boolean;
}) {
  const [v, setV] = useState<StandingOrderInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useRun(copy);
  const router = useRouter();
  const day = (d: number) => copy[`day.${d}`] ?? String(d);
  const toggleDay = (d: number) =>
    setV((s) => ({
      ...s,
      weekdays: s.weekdays.includes(d) ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d].sort(),
    }));
  const setDayItem = (d: number, idx: number, id: string) =>
    setV((s) => {
      const list = [...(s.day_items[String(d)] ?? [])];
      if (id) list[idx] = id;
      else list.splice(idx, 1);
      return { ...s, day_items: { ...s.day_items, [String(d)]: list.filter(Boolean) } };
    });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => (save ?? saveStandingOrder)(v),
          copy["standing.saved"],
          (r) => {
            setErrors(r.fieldErrors ?? {});
            if (r.ok && afterSave) router.push(afterSave);
          },
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="so-name" label={copy["standing.name"]} hint={copy["standing.name_hint"]} error={errors.name}>
          <Input id="so-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
        </Field>
        <Field id="so-room" label={copy["standing.classroom"]} error={errors.classroom_id}>
          <select
            id="so-room"
            className={selectClass}
            value={v.classroom_id}
            onChange={(e) => setV({ ...v, classroom_id: e.target.value })}
          >
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {fmt(copy["standing.classroom_option"], { name: c.name, count: c.headcount })}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{copy["standing.weekdays"]}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.slice(0, 5).map((d) => (
            <Chip key={d} pressed={v.weekdays.includes(d)} onPressedChange={() => toggleDay(d)}>
              {day(d)}
            </Chip>
          ))}
        </div>
        {errors.weekdays ? <p className="mt-1 text-sm font-semibold text-destructive">{errors.weekdays}</p> : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="so-start" label={copy["standing.start"]} error={errors.start_date}>
          <Input
            id="so-start"
            type="date"
            value={v.start_date}
            onChange={(e) => setV({ ...v, start_date: e.target.value })}
            required
          />
        </Field>
        <Field id="so-end" label={copy["standing.end"]} hint={copy["standing.end_hint"]} error={errors.end_date}>
          <Input
            id="so-end"
            type="date"
            value={v.end_date ?? ""}
            onChange={(e) => setV({ ...v, end_date: e.target.value || null })}
          />
        </Field>
        <Field id="so-status" label={copy["standing.status"]}>
          <select
            id="so-status"
            className={selectClass}
            value={v.status}
            onChange={(e) => setV({ ...v, status: e.target.value as StandingOrderInput["status"] })}
          >
            {(["active", "paused", "ended", "draft"] as const).map((s) => (
              <option key={s} value={s}>
                {copy[`standing.status_${s}`]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">{copy["standing.quantity"]}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip
            pressed={v.quantity_mode === "per_headcount"}
            onPressedChange={() => setV({ ...v, quantity_mode: "per_headcount" })}
          >
            {copy["standing.per_headcount"]}
          </Chip>
          <Chip
            pressed={v.quantity_mode === "fixed"}
            onPressedChange={() => setV({ ...v, quantity_mode: "fixed", fixed_quantity: v.fixed_quantity ?? 20 })}
          >
            {copy["standing.fixed"]}
          </Chip>
        </div>
        {v.quantity_mode === "per_headcount" ? (
          <Field
            id="so-buffer"
            label={copy["standing.buffer"]}
            hint={copy["standing.buffer_hint"]}
            className="max-w-xs"
          >
            <Input
              id="so-buffer"
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              value={v.buffer_percent}
              onChange={(e) => setV({ ...v, buffer_percent: Number(e.target.value) })}
            />
          </Field>
        ) : (
          <Field id="so-fixed" label={copy["standing.fixed_count"]} error={errors.fixed_quantity} className="max-w-xs">
            <Input
              id="so-fixed"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={v.fixed_quantity ?? ""}
              onChange={(e) => setV({ ...v, fixed_quantity: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">{copy["standing.menu"]}</legend>
        <div className="flex flex-wrap gap-2">
          {(["chefs_choice", "specific_items", "category_rotation"] as const).map((m) => (
            <Chip
              key={m}
              pressed={v.menu_selection_mode === m}
              onPressedChange={() => setV({ ...v, menu_selection_mode: m })}
            >
              {copy[`standing.mode_${m}`]}
            </Chip>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{copy[`standing.mode_${v.menu_selection_mode}_help`]}</p>

        {v.menu_selection_mode === "specific_items" ? (
          <div className="space-y-3">
            {v.weekdays.map((d) => {
              const list = v.day_items[String(d)] ?? [];
              return (
                <div key={d} className="rounded-xl border-2 border-ink/20 p-3">
                  <p className="mb-2 font-semibold">{day(d)}</p>
                  <div className="space-y-2">
                    {[...list, ""].slice(0, 5).map((id, idx) => (
                      <select
                        key={`${d}-${idx}`}
                        aria-label={fmt(copy["standing.item_for_day"], { day: day(d), n: idx + 1 })}
                        className={selectClass}
                        value={id}
                        onChange={(e) => setDayItem(d, idx, e.target.value)}
                      >
                        <option value="">
                          {idx < list.length ? copy["standing.remove_item"] : copy["standing.add_item"]}
                        </option>
                        {catalog.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.allergens.length ? `${i.name} (${i.allergens.join(", ")})` : i.name}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>
                </div>
              );
            })}
            {errors.day_items ? <p className="text-sm font-semibold text-destructive">{errors.day_items}</p> : null}
          </div>
        ) : null}

        {v.menu_selection_mode === "category_rotation" ? (
          <div className="space-y-2">
            {v.rotation.map((r, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <Field id={`rot-cat-${idx}`} label={copy["standing.category"]} className="min-w-48 flex-1">
                  <select
                    id={`rot-cat-${idx}`}
                    className={selectClass}
                    value={r.category_id}
                    onChange={(e) =>
                      setV({
                        ...v,
                        rotation: v.rotation.map((x, i) => (i === idx ? { ...x, category_id: e.target.value } : x)),
                      })
                    }
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={`rot-n-${idx}`} label={copy["standing.per_child"]} className="w-28">
                  <Input
                    id={`rot-n-${idx}`}
                    type="number"
                    min={1}
                    max={3}
                    value={r.count}
                    onChange={(e) =>
                      setV({
                        ...v,
                        rotation: v.rotation.map((x, i) => (i === idx ? { ...x, count: Number(e.target.value) } : x)),
                      })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={copy["standing.remove_category"]}
                  onClick={() => setV({ ...v, rotation: v.rotation.filter((_, i) => i !== idx) })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            {v.rotation.length < 6 && categories.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setV({ ...v, rotation: [...v.rotation, { category_id: categories[0]!.id, count: 1 }] })}
              >
                <Plus aria-hidden="true" /> {copy["standing.add_category"]}
              </Button>
            ) : null}
            {errors.rotation ? <p className="text-sm font-semibold text-destructive">{errors.rotation}</p> : null}
          </div>
        ) : null}
      </fieldset>

      <Field id="so-notes" label={copy["standing.notes"]} hint={copy["standing.notes_hint"]}>
        <textarea
          id="so-notes"
          className={textareaClass}
          value={v.notes}
          onChange={(e) => setV({ ...v, notes: e.target.value })}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {copy["standing.save"]}
        </Button>
        {v.id && allowDelete ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(copy["standing.delete_confirm"])) return;
              run(
                () => (remove ?? ((id: string) => deleteStandingOrder({ id })))(v.id!),
                copy["standing.deleted"],
                (r) => r.ok && afterSave && router.push(afterSave),
              );
            }}
          >
            <Trash2 aria-hidden="true" /> {copy["standing.delete"]}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
