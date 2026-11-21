"use client";

import { Copy, Eye, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ChipToggle, Field } from "@/components/admin/fields";
import { ItemListBuilder, type BuilderItem, type CatalogItem } from "@/components/admin/menu/item-list-builder";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/auth/action-result";
import { addDays, formatDay, formatInZone, fromZonedInput, toZonedInput } from "@/lib/time";

import { applyTemplate, copyLastWeek, saveAsTemplate, saveWeek, setWeekStatus } from "../actions";

type Week = {
  id: string;
  week_start: string;
  status: string;
  delivery_dates: string[];
  ordering_opens_at: string | null;
  cutoff_at: string | null;
  notes_to_families: string;
};

const notify = (r: ActionResult<unknown>) => (r.ok ? toast.success(r.message ?? "Done") : toast.error(r.message));

export function WeekBuilder({
  week,
  items: initialItems,
  catalog,
  templates,
  timezone,
  effectiveCutoff,
}: {
  week: Week;
  items: BuilderItem[];
  catalog: CatalogItem[];
  templates: { id: string; name: string }[];
  timezone: string;
  effectiveCutoff: string | null;
}) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const initial = { week, items: initialItems };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [confirmZero, setConfirmZero] = useState(false);
  const [zeroWarning, setZeroWarning] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(form) !== saved, [form, saved]);
  useUnsavedGuard(dirty);

  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(week.week_start, i));
  const setWeek = (patch: Partial<Week>) => setForm((f) => ({ ...f, week: { ...f.week, ...patch } }));

  async function save() {
    setSaving(true);
    try {
      const r = await runWithStepUp(() =>
        saveWeek({
          id: week.id,
          delivery_dates: form.week.delivery_dates,
          ordering_opens_at: form.week.ordering_opens_at,
          cutoff_at: form.week.cutoff_at,
          notes_to_families: form.week.notes_to_families,
          items: form.items,
        }),
      );
      notify(r);
      if (r.ok) {
        setSaved(JSON.stringify(form));
        router.refresh();
      }
      return r.ok;
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(status: "draft" | "scheduled" | "published" | "closed" | "fulfilled") {
    if (dirty && !(await save())) return;
    const r = await setWeekStatus({ id: week.id, status, confirm_zero_allergens: confirmZero });
    if (!r.ok && r.fieldErrors?.confirm_zero_allergens) setZeroWarning(r.fieldErrors.confirm_zero_allergens);
    notify(r);
    if (r.ok) router.refresh();
  }

  async function replaceFrom(fn: () => Promise<ActionResult<unknown>>) {
    if (dirty && !window.confirm("This replaces the meals on this week and discards unsaved changes. Continue?"))
      return;
    const r = await runWithStepUp(fn);
    notify(r);
    if (r.ok) window.location.reload();
  }

  return (
    <div className="space-y-6">
      <section
        className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-ink bg-paper p-4"
        aria-label="Week actions"
      >
        <label className="flex items-center gap-2 text-sm font-semibold">
          Apply template
          <select
            className="h-10 rounded-md border-2 border-ink bg-card px-2"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              e.target.value = "";
              if (id) void replaceFrom(() => applyTemplate({ week_id: week.id, template_id: id }));
            }}
          >
            <option value="">Choose…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={() => replaceFrom(() => copyLastWeek({ week_id: week.id }))}>
          <Copy aria-hidden="true" /> Copy last week
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const name = window.prompt("Name this template", `Week of ${formatDay(week.week_start)}`);
            if (name) notify(await runWithStepUp(() => saveAsTemplate({ week_id: week.id, name })));
          }}
        >
          <Save aria-hidden="true" /> Save as template
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/menu?preview=${week.id}`} target="_blank">
            <Eye aria-hidden="true" /> Preview as a family
          </Link>
        </Button>
      </section>

      <section
        className="grid gap-5 rounded-2xl border-2 border-ink bg-paper p-5 md:grid-cols-2"
        aria-labelledby="schedule-h"
      >
        <h2 id="schedule-h" className="text-xl font-bold md:col-span-2">
          Delivery & ordering
        </h2>
        <fieldset className="md:col-span-2">
          <legend className="mb-2 font-semibold">Delivery days</legend>
          <div className="flex flex-wrap gap-2">
            {days.map((d) => (
              <ChipToggle
                key={d}
                pressed={form.week.delivery_dates.includes(d)}
                onPressedChange={(on) =>
                  setWeek({
                    delivery_dates: on
                      ? [...form.week.delivery_dates, d].sort()
                      : form.week.delivery_dates.filter((x) => x !== d),
                  })
                }
              >
                {formatDay(d)}
              </ChipToggle>
            ))}
          </div>
        </fieldset>
        <Field
          id="opens"
          label={`Ordering opens (${timezone.replace("_", " ")})`}
          help="Leave empty to open as soon as the week is published."
        >
          <Input
            id="opens"
            type="datetime-local"
            value={toZonedInput(form.week.ordering_opens_at, timezone)}
            onChange={(e) => setWeek({ ordering_opens_at: fromZonedInput(e.target.value, timezone) })}
          />
        </Field>
        <Field
          id="cutoff"
          label={`Ordering cutoff (${timezone.replace("_", " ")})`}
          help={
            form.week.cutoff_at
              ? "Custom cutoff for this week."
              : `Using the default rule: ${formatInZone(effectiveCutoff, timezone)}. Set a time to override it.`
          }
        >
          <div className="flex gap-2">
            <Input
              id="cutoff"
              type="datetime-local"
              value={toZonedInput(form.week.cutoff_at, timezone)}
              onChange={(e) => setWeek({ cutoff_at: fromZonedInput(e.target.value, timezone) })}
            />
            {form.week.cutoff_at ? (
              <Button type="button" variant="ghost" onClick={() => setWeek({ cutoff_at: null })}>
                Use default
              </Button>
            ) : null}
          </div>
        </Field>
        <Field
          id="notes"
          label="Note to families"
          className="md:col-span-2"
          help="Shown at the top of this week's menu."
        >
          <textarea
            id="notes"
            rows={2}
            maxLength={2000}
            value={form.week.notes_to_families}
            onChange={(e) => setWeek({ notes_to_families: e.target.value })}
            className="w-full rounded-md border-2 border-ink bg-card px-3 py-2"
          />
        </Field>
      </section>

      <section className="rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="meals-h">
        <h2 id="meals-h" className="mb-4 text-xl font-bold">
          Meals
        </h2>
        <ItemListBuilder items={form.items} onChange={(items) => setForm((f) => ({ ...f, items }))} catalog={catalog} />
      </section>

      <section className="space-y-3 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="publish-h">
        <h2 id="publish-h" className="text-xl font-bold">
          Publish
        </h2>
        {zeroWarning ? (
          <label className="flex items-start gap-3 rounded-xl border-2 border-allergy bg-card p-3 text-sm font-semibold">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={confirmZero}
              onChange={(e) => setConfirmZero(e.target.checked)}
            />
            I&apos;ve checked: {zeroWarning} really contain none of the listed allergens.
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {week.status !== "published" ? <Button onClick={() => changeStatus("published")}>Publish now</Button> : null}
          {week.status === "draft" ? (
            <Button variant="outline" onClick={() => changeStatus("scheduled")}>
              Mark as scheduled
            </Button>
          ) : null}
          {week.status === "published" ? (
            <Button variant="outline" onClick={() => changeStatus("closed")}>
              Close ordering
            </Button>
          ) : null}
          {week.status === "closed" ? (
            <Button variant="outline" onClick={() => changeStatus("fulfilled")}>
              Mark fulfilled
            </Button>
          ) : null}
          {week.status !== "draft" ? (
            <Button variant="ghost" onClick={() => changeStatus("draft")}>
              Back to draft
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Publishing checks there&apos;s at least one meal, the cutoff is before the first delivery day, and every meal
          has its allergens set.
        </p>
      </section>

      <UnsavedBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setForm(JSON.parse(saved))} />
    </div>
  );
}
