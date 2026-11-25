"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { placeBulkOrder } from "@/app/(school)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Classroom, SchoolMenuItem } from "@/lib/school/queries";
import { formatDay } from "@/lib/time";

import { Field, selectClass, textareaClass, useRun, type Copy } from "./kit";

type Line = { menu_item_id: string; delivery_date: string; quantity: number; classroom_id: string | null };

/** One-off bulk order (events, parties, staff lunches), invoiced monthly. */
export function BulkOrderForm({
  copy,
  weeks,
  classrooms,
}: {
  copy: Copy;
  weeks: { id: string; label: string; delivery_dates: string[]; items: SchoolMenuItem[] }[];
  classrooms: Classroom[];
}) {
  const [weekId, setWeekId] = useState(weeks[0]?.id ?? "");
  const week = weeks.find((w) => w.id === weekId);
  const blank = (): Line => ({
    menu_item_id: week?.items[0]?.id ?? "",
    delivery_date: week?.delivery_dates[0] ?? "",
    quantity: 10,
    classroom_id: null,
  });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useRun(copy);
  const router = useRouter();
  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  if (!week) return <p className="text-muted-foreground">{copy["bulk.no_weeks"]}</p>;
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => placeBulkOrder({ menu_week_id: weekId, location, notes, items: lines }),
          copy["bulk.placed"],
          (r) => {
            setErrors(r.fieldErrors ?? {});
            if (r.ok) router.push(`/school/orders?week=${weekId}`);
          },
        );
      }}
    >
      <Field id="bulk-week" label={copy["bulk.week"]}>
        <select
          id="bulk-week"
          className={selectClass}
          value={weekId}
          onChange={(e) => {
            setWeekId(e.target.value);
            const w = weeks.find((x) => x.id === e.target.value);
            setLines([
              {
                menu_item_id: w?.items[0]?.id ?? "",
                delivery_date: w?.delivery_dates[0] ?? "",
                quantity: 10,
                classroom_id: null,
              },
            ]);
          }}
        >
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">{copy["bulk.items"]}</legend>
        {lines.map((l, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-xl border-2 border-ink/20 p-3 sm:grid-cols-[2fr_1fr_6rem_1.5fr_auto] sm:items-end"
          >
            <Field id={`bulk-item-${i}`} label={copy["bulk.item"]}>
              <select
                id={`bulk-item-${i}`}
                className={selectClass}
                value={l.menu_item_id}
                onChange={(e) => update(i, { menu_item_id: e.target.value })}
              >
                {week.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.allergens.length ? `${it.name} (${it.allergens.join(", ")})` : it.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`bulk-day-${i}`} label={copy["bulk.day"]}>
              <select
                id={`bulk-day-${i}`}
                className={selectClass}
                value={l.delivery_date}
                onChange={(e) => update(i, { delivery_date: e.target.value })}
              >
                {week.delivery_dates.map((d) => (
                  <option key={d} value={d}>
                    {formatDay(d)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`bulk-qty-${i}`} label={copy["bulk.quantity"]} error={errors[`items.${i}.quantity`]}>
              <Input
                id={`bulk-qty-${i}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                value={l.quantity}
                onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              />
            </Field>
            <Field id={`bulk-room-${i}`} label={copy["bulk.classroom"]}>
              <select
                id={`bulk-room-${i}`}
                className={selectClass}
                value={l.classroom_id ?? ""}
                onChange={(e) => update(i, { classroom_id: e.target.value || null })}
              >
                <option value="">{copy["bulk.no_classroom"]}</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={copy["bulk.remove_line"]}
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        {lines.length < 50 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Plus aria-hidden="true" /> {copy["bulk.add_line"]}
          </Button>
        ) : null}
      </fieldset>

      <Field id="bulk-location" label={copy["bulk.location"]} hint={copy["bulk.location_hint"]} error={errors.location}>
        <Input id="bulk-location" value={location} onChange={(e) => setLocation(e.target.value)} required />
      </Field>
      <Field id="bulk-notes" label={copy["bulk.notes"]}>
        <textarea id="bulk-notes" className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <p className="text-sm text-muted-foreground">{copy["bulk.allergy_note"]}</p>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {copy["bulk.place"]}
      </Button>
    </form>
  );
}
