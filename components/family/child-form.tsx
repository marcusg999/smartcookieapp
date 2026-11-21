"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { saveChild, type Conflict } from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Severity } from "@/lib/ordering/logic";
import { formatDay } from "@/lib/time";

import { Chip, fmt, type Copy } from "./kit";

export type SchoolOption = {
  organization_id: string;
  name: string;
  classroom_id: string;
  classroom_name: string;
  grade: string | null;
};

export type ChildFormValue = {
  id?: string;
  firstName: string;
  lastInitial: string;
  grade: string;
  schoolId: string;
  classroomId: string;
  allergies: { allergenId: string; severity: Severity }[];
  dietary: string[];
  notes: string;
};

export const emptyChild: ChildFormValue = {
  firstName: "",
  lastInitial: "",
  grade: "",
  schoolId: "",
  classroomId: "",
  allergies: [],
  dietary: [],
  notes: "",
};

/**
 * Add / edit a child: first name + last initial only (CLAUDE.md §5.11), big
 * tappable allergy chips for the top 9 and owner-added allergens, a severity
 * per allergy, and dietary badges. Saving re-checks upcoming orders.
 */
export function ChildForm({
  copy,
  allergens,
  badges,
  schools,
  initial = emptyChild,
  preferSchool = false,
  onSaved,
  onCancel,
}: {
  copy: Copy;
  allergens: { id: string; name: string; is_top9: boolean }[];
  badges: { name: string }[];
  schools: SchoolOption[];
  initial?: ChildFormValue;
  preferSchool?: boolean;
  onSaved?: (id: string) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [v, setV] = useState<ChildFormValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [pending, start] = useTransition();
  const set = <K extends keyof ChildFormValue>(k: K, value: ChildFormValue[K]) => setV((s) => ({ ...s, [k]: value }));

  const schoolList = [...new Map(schools.map((s) => [s.organization_id, s.name])).entries()];
  const classrooms = schools.filter((s) => s.organization_id === v.schoolId);
  const severityOf = (allergenId: string) => v.allergies.find((a) => a.allergenId === allergenId)?.severity;

  const toggleAllergy = (allergenId: string, on: boolean) =>
    set(
      "allergies",
      on
        ? [...v.allergies, { allergenId, severity: "allergy" }]
        : v.allergies.filter((a) => a.allergenId !== allergenId),
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveChild(v);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.message);
        return;
      }
      setErrors({});
      toast.success(copy.saved);
      setConflicts(res.data?.conflicts ?? []);
      if (!res.data?.conflicts.length) onSaved?.(res.data!.id);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-first`} className="font-semibold">
            {copy.first_name}
          </Label>
          <Input
            id={`${id}-first`}
            value={v.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            autoComplete="off"
            required
            maxLength={40}
            aria-invalid={Boolean(errors.firstName)}
            aria-describedby={errors.firstName ? `${id}-first-err` : undefined}
          />
          {errors.firstName ? (
            <p id={`${id}-first-err`} className="text-sm font-semibold text-destructive">
              {errors.firstName}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-initial`} className="font-semibold">
            {copy.last_initial}
          </Label>
          <Input
            id={`${id}-initial`}
            value={v.lastInitial}
            onChange={(e) => set("lastInitial", e.target.value.slice(0, 1))}
            maxLength={1}
            autoComplete="off"
            className="text-center uppercase"
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-semibold">{copy.allergies}</legend>
        <p className="text-sm text-muted-foreground">{copy.allergies_help}</p>
        <div className="flex flex-wrap gap-2">
          {allergens.map((a) => (
            <Chip
              key={a.id}
              tone="allergy"
              pressed={Boolean(severityOf(a.id))}
              onPressedChange={(on) => toggleAllergy(a.id, on)}
            >
              {a.name}
            </Chip>
          ))}
        </div>
        {v.allergies.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {v.allergies.map((a) => {
              const name = allergens.find((x) => x.id === a.allergenId)?.name ?? "";
              return (
                <li
                  key={a.allergenId}
                  className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-allergy/40 bg-paper p-2"
                >
                  <span className="min-w-20 font-bold text-allergy">{name}</span>
                  <span className="sr-only">{copy.severity}</span>
                  {(["intolerance", "allergy", "severe"] as const).map((sev) => (
                    <label
                      key={sev}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-2 border-ink/30 px-3 py-1 text-sm font-semibold has-checked:border-ink has-checked:bg-orange-tint"
                    >
                      <input
                        type="radio"
                        name={`${id}-sev-${a.allergenId}`}
                        checked={a.severity === sev}
                        onChange={() =>
                          set(
                            "allergies",
                            v.allergies.map((x) => (x.allergenId === a.allergenId ? { ...x, severity: sev } : x)),
                          )
                        }
                        className="accent-[var(--ink)]"
                      />
                      {copy[`severity_${sev}`]}
                    </label>
                  ))}
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-sm">
          <span className="font-semibold">{copy.custom_allergy}</span> {copy.custom_allergy_help}
        </p>
      </fieldset>

      {badges.length ? (
        <fieldset className="space-y-2">
          <legend className="font-semibold">{copy.dietary}</legend>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <Chip
                key={b.name}
                pressed={v.dietary.includes(b.name)}
                onPressedChange={(on) =>
                  set("dietary", on ? [...v.dietary, b.name] : v.dietary.filter((d) => d !== b.name))
                }
              >
                {b.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className={preferSchool ? "rounded-xl border-2 border-ink bg-orange-tint p-3" : ""}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-school`} className="font-semibold">
              {copy.school}
            </Label>
            <select
              id={`${id}-school`}
              value={v.schoolId}
              onChange={(e) => setV((s) => ({ ...s, schoolId: e.target.value, classroomId: "" }))}
              className="h-11 w-full rounded-md border-2 border-ink bg-paper px-3"
            >
              <option value="">{copy.no_school}</option>
              {schoolList.map(([sid, name]) => (
                <option key={sid} value={sid}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-grade`} className="font-semibold">
              {copy.grade}
            </Label>
            <Input id={`${id}-grade`} value={v.grade} onChange={(e) => set("grade", e.target.value)} maxLength={20} />
          </div>
        </div>
        {v.schoolId ? (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor={`${id}-room`} className="font-semibold">
              {copy.classroom}
            </Label>
            <select
              id={`${id}-room`}
              value={v.classroomId}
              onChange={(e) => set("classroomId", e.target.value)}
              className="h-11 w-full rounded-md border-2 border-ink bg-paper px-3"
            >
              <option value="">–</option>
              {classrooms.map((c) => (
                <option key={c.classroom_id} value={c.classroom_id}>
                  {c.classroom_name}
                  {c.grade ? ` (${c.grade})` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-notes`} className="font-semibold">
          {copy.notes}
        </Label>
        <textarea
          id={`${id}-notes`}
          value={v.notes}
          onChange={(e) => set("notes", e.target.value)}
          maxLength={500}
          rows={2}
          className="w-full rounded-md border-2 border-ink bg-paper px-3 py-2"
        />
      </div>

      {conflicts.length ? (
        <div role="alert" className="rounded-xl border-2 border-allergy bg-paper p-4">
          <p className="flex items-center gap-2 font-bold text-allergy">
            <AlertTriangle aria-hidden="true" className="size-5" />
            {fmt(copy.conflicts_title, { name: v.firstName })}
          </p>
          <p className="mt-1 text-sm">{copy.conflicts_body}</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.order_number} · {formatDay(c.delivery_date)} · {c.item_name} ({c.allergens})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} size="lg">
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {copy.save}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" size="lg" onClick={onCancel}>
            {copy.cancel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
