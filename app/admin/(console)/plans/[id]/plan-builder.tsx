"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ChipToggle, formatCents, MoneyInput } from "@/components/admin/fields";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { useStepUp } from "@/components/mfa/step-up";
import { RichText } from "@/components/rich-text";
import { Input } from "@/components/ui/input";
import type { RichNode } from "@/lib/validation/rich-text";

import { savePlan, type PlanInput } from "../actions";

type Plan = PlanInput & { id?: string };
const EVERY = { week: "every week", two_weeks: "every 2 weeks", month: "every month" } as const;

function Q({ q, help, children }: { q: string; help?: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-b-2 border-dashed border-ink/20 pb-5 last:border-0">
      <p className="font-bold">{q}</p>
      {help ? <p className="text-sm text-muted-foreground">{help}</p> : null}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Input
      type="number"
      aria-label={label}
      className="w-28"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
    />
  );
}

export function PlanBuilder({ plan: initial, subscribers }: { plan: Plan; subscribers: number }) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const [p, setP] = useState<Plan>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [subChoice, setSubChoice] = useState<"keep_old_price" | "move_at_renewal">("keep_old_price");
  const dirty = useMemo(() => JSON.stringify(p) !== saved, [p, saved]);
  useUnsavedGuard(dirty);
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setP((x) => ({ ...x, [k]: v }));
  const priceChanged =
    !!initial.id && (p.price_cents !== initial.price_cents || p.billing_interval !== initial.billing_interval);
  const kids = 2;
  const total = p.allowance_unit === "per_child" ? p.price_cents * kids : p.price_cents;
  const meals = p.allowance_unit === "per_child" ? p.meals_per_interval * kids : p.meals_per_interval;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-5 rounded-2xl border-2 border-ink bg-paper p-5">
        <Q q="What's the plan called?">
          <Input
            aria-label="Plan name"
            value={p.name}
            maxLength={80}
            onChange={(e) => set("name", e.target.value)}
            placeholder="3 Lunches a week"
          />
        </Q>
        <Q q="Who is it for?">
          <ChipToggle pressed={p.audience === "family"} onPressedChange={() => set("audience", "family")}>
            Families
          </ChipToggle>
          <ChipToggle pressed={p.audience === "school"} onPressedChange={() => set("audience", "school")}>
            Schools
          </ChipToggle>
        </Q>
        <Q q="How often are customers billed?">
          {(["week", "two_weeks", "month"] as const).map((i) => (
            <ChipToggle key={i} pressed={p.billing_interval === i} onPressedChange={() => set("billing_interval", i)}>
              {EVERY[i]}
            </ChipToggle>
          ))}
        </Q>
        <Q
          q="How much do they pay each time?"
          help={p.allowance_unit === "per_child" ? "This is per child." : "This is for the whole household."}
        >
          <div className="w-40">
            <MoneyInput id="plan-price" cents={p.price_cents} onChange={(v) => set("price_cents", v ?? 0)} />
          </div>
        </Q>
        <Q q="Is that price per child or per household?">
          <ChipToggle
            pressed={p.allowance_unit === "per_child"}
            onPressedChange={() => set("allowance_unit", "per_child")}
          >
            Per child
          </ChipToggle>
          <ChipToggle
            pressed={p.allowance_unit === "per_household"}
            onPressedChange={() => set("allowance_unit", "per_household")}
          >
            Per household
          </ChipToggle>
        </Q>
        <Q q="How many meals does each billing period include?">
          <NumberInput
            label="Meals per period"
            value={p.meals_per_interval}
            min={1}
            onChange={(v) => set("meals_per_interval", v)}
          />
        </Q>
        <Q q="What does an extra meal cost beyond the plan?" help="Leave empty if extra meals aren't allowed.">
          <div className="w-40">
            <MoneyInput
              id="extra"
              cents={p.price_per_extra_meal_cents ?? null}
              allowEmpty
              onChange={(v) => set("price_per_extra_meal_cents", v)}
            />
          </div>
        </Q>
        <Q q="Are snacks included?">
          <ChipToggle pressed={p.includes_snacks} onPressedChange={(v) => set("includes_snacks", v)}>
            {p.includes_snacks ? "Yes" : "No"}
          </ChipToggle>
          {p.includes_snacks ? (
            <NumberInput
              label="Snacks per period"
              value={p.snacks_per_interval}
              onChange={(v) => set("snacks_per_interval", v)}
            />
          ) : null}
        </Q>
        <Q q="Can customers skip a week? How many times a month?">
          <ChipToggle pressed={p.allow_skip} onPressedChange={(v) => set("allow_skip", v)}>
            {p.allow_skip ? "Yes, they can skip" : "No skipping"}
          </ChipToggle>
          {p.allow_skip ? (
            <NumberInput
              label="Skips per month"
              value={p.max_skips_per_month}
              max={31}
              onChange={(v) => set("max_skips_per_month", v)}
            />
          ) : null}
        </Q>
        <Q q="Can customers pause their plan?">
          <ChipToggle pressed={p.allow_pause} onPressedChange={(v) => set("allow_pause", v)}>
            {p.allow_pause ? "Yes" : "No"}
          </ChipToggle>
        </Q>
        <Q q="What happens to unused meals?">
          <ChipToggle pressed={!p.rollover_unused} onPressedChange={() => set("rollover_unused", false)}>
            They expire
          </ChipToggle>
          <ChipToggle pressed={p.rollover_unused} onPressedChange={() => set("rollover_unused", true)}>
            They roll over
          </ChipToggle>
          {p.rollover_unused ? (
            <NumberInput
              label="Most meals that can roll over"
              value={p.max_rollover}
              onChange={(v) => set("max_rollover", v)}
            />
          ) : null}
        </Q>
        <Q q="If a customer doesn't pick meals by the cutoff, should we…">
          <ChipToggle
            pressed={p.auto_fill_strategy === "favorites"}
            onPressedChange={() => set("auto_fill_strategy", "favorites")}
          >
            Use their favorites
          </ChipToggle>
          <ChipToggle
            pressed={p.auto_fill_strategy === "chefs_choice"}
            onPressedChange={() => set("auto_fill_strategy", "chefs_choice")}
          >
            Use chef&apos;s choice
          </ChipToggle>
          <ChipToggle
            pressed={p.auto_fill_strategy === "none"}
            onPressedChange={() => set("auto_fill_strategy", "none")}
          >
            Do nothing
          </ChipToggle>
        </Q>
        <Q q="Minimum commitment and free trial (in billing periods)">
          <label className="text-sm font-semibold">
            Minimum{" "}
            <NumberInput
              label="Minimum billing periods"
              value={p.min_commitment_intervals}
              max={52}
              onChange={(v) => set("min_commitment_intervals", v)}
            />
          </label>
          <label className="text-sm font-semibold">
            Free trial{" "}
            <NumberInput
              label="Trial billing periods"
              value={p.trial_intervals}
              max={12}
              onChange={(v) => set("trial_intervals", v)}
            />
          </label>
        </Q>
        <Q q="Description customers see">
          <div className="w-full">
            <RichTextEditor
              id="plan-desc"
              label="Plan description"
              value={(p.description_rich as RichNode) ?? null}
              onChange={(d) => set("description_rich", d as never)}
            />
          </div>
        </Q>
        <Q
          q="Open for new sign-ups?"
          help="Closing a plan hides it from new customers. Existing subscribers continue as normal."
        >
          <ChipToggle pressed={p.is_active} onPressedChange={(v) => set("is_active", v)}>
            {p.is_active ? "Open" : "Closed to new sign-ups"}
          </ChipToggle>
        </Q>
        {priceChanged && subscribers > 0 ? (
          <fieldset className="space-y-2 rounded-xl border-2 border-ink bg-accent p-4">
            <legend className="px-1 font-bold">
              This plan has {subscribers} subscriber(s). What should happen to them?
            </legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="subs"
                className="mt-1"
                checked={subChoice === "keep_old_price"}
                onChange={() => setSubChoice("keep_old_price")}
              />{" "}
              Keep existing subscribers on their current price (only new sign-ups pay the new price).
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="subs"
                className="mt-1"
                checked={subChoice === "move_at_renewal"}
                onChange={() => setSubChoice("move_at_renewal")}
              />{" "}
              Move everyone to the new price at their next renewal. Nobody is charged extra mid-period.
            </label>
          </fieldset>
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Preview">
        <p className="text-sm font-bold tracking-wide uppercase">Customers see</p>
        <div className="rounded-2xl border-2 border-ink bg-card p-5 shadow-ink">
          <h3 className="text-2xl font-bold">{p.name || "Plan name"}</h3>
          <p className="mt-1 text-3xl font-black">
            {formatCents(p.price_cents)}
            <span className="text-base font-semibold">
              {" "}
              {p.allowance_unit === "per_child" ? "per child " : ""}
              {EVERY[p.billing_interval]}
            </span>
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            <li>
              ✓ {p.meals_per_interval} meals {EVERY[p.billing_interval]}
            </li>
            {p.includes_snacks ? <li>✓ {p.snacks_per_interval} snacks included</li> : null}
            {p.allow_skip ? <li>✓ Skip up to {p.max_skips_per_month} times a month</li> : null}
            {p.allow_pause ? <li>✓ Pause any time</li> : null}
            {p.rollover_unused ? <li>✓ Unused meals roll over (up to {p.max_rollover})</li> : null}
            {p.trial_intervals ? <li>✓ First {p.trial_intervals} free</li> : null}
          </ul>
          {p.description_rich ? <RichText doc={p.description_rich as RichNode} className="mt-3 text-sm" /> : null}
        </div>
        <p className="rounded-xl border-2 border-ink bg-paper p-4 text-sm">
          <strong>Example:</strong> a family with {kids} kids on this plan pays <strong>{formatCents(total)}</strong>{" "}
          {EVERY[p.billing_interval]} for <strong>{meals} meals</strong>.
        </p>
      </aside>

      <div className="lg:col-span-2">
        <UnsavedBar
          dirty={dirty || !initial.id}
          saving={saving}
          onDiscard={initial.id ? () => setP(JSON.parse(saved)) : undefined}
          saveLabel={initial.id ? "Save plan" : "Create plan"}
          onSave={async () => {
            setSaving(true);
            const r = await runWithStepUp(() => savePlan({ ...p, existing_subscribers: subChoice }));
            setSaving(false);
            if (!r.ok) return void toast.error(r.message);
            toast.success(r.message);
            setSaved(JSON.stringify(p));
            const newId = (r as { data?: { id: string } }).data?.id;
            if (!initial.id && newId) router.replace(`/admin/plans/${newId}`);
            else router.refresh();
          }}
        />
      </div>
    </div>
  );
}
