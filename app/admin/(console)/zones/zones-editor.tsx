"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ChipToggle, Field, formatCents, MoneyInput } from "@/components/admin/fields";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveZone } from "./actions";

type Zone = {
  id?: string;
  name: string;
  zip_codes: string;
  fee_cents: number;
  free_over_cents: number | null;
  min_order_cents: number;
  delivery_weekdays: number[];
  delivery_window_label: string;
  is_active: boolean;
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ZonesEditor({ zones, canEditFees }: { zones: Zone[]; canEditFees: boolean }) {
  const [zip, setZip] = useState("");
  const [creating, setCreating] = useState(false);
  const match = /^\d{5}$/.test(zip)
    ? zones.filter((z) => z.is_active && z.zip_codes.split(/[\s,]+/).includes(zip))
    : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border-2 border-ink bg-paper p-4" aria-labelledby="tester">
        <h2 id="tester" className="mb-2 font-bold">
          ZIP lookup
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative">
            <span className="sr-only">ZIP code</span>
            <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              inputMode="numeric"
              maxLength={5}
              placeholder="90026"
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
              className="w-36 pl-9"
            />
          </label>
          {match === null ? (
            <span className="text-sm text-muted-foreground">Type a 5-digit ZIP to check coverage.</span>
          ) : match.length ? (
            <span role="status" className="font-semibold">
              ✓ {zip} is covered by {match.map((m) => `${m.name} (${formatCents(m.fee_cents)} delivery)`).join(", ")}.
            </span>
          ) : (
            <span role="status" className="font-semibold text-destructive">
              ✗ {zip} isn&apos;t in any active zone.
            </span>
          )}
        </div>
      </section>
      {zones.map((z) => (
        <ZoneCard key={z.id} zone={z} canEditFees={canEditFees} />
      ))}
      {creating ? (
        <ZoneCard
          zone={{
            name: "",
            zip_codes: "",
            fee_cents: 500,
            free_over_cents: null,
            min_order_cents: 0,
            delivery_weekdays: [1, 2, 3, 4, 5],
            delivery_window_label: "",
            is_active: true,
          }}
          canEditFees={canEditFees}
          onDone={() => setCreating(false)}
        />
      ) : canEditFees ? (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" /> Add a zone
        </Button>
      ) : null}
    </div>
  );
}

function ZoneCard({ zone, canEditFees, onDone }: { zone: Zone; canEditFees: boolean; onDone?: () => void }) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const [z, setZ] = useState(zone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(z) !== JSON.stringify(zone);
  const set = <K extends keyof Zone>(k: K, v: Zone[K]) => setZ((x) => ({ ...x, [k]: v }));
  const fid = (s: string) => `${zone.id ?? "new"}-${s}`;

  return (
    <section className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5" aria-label={z.name || "New zone"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={fid("name")} label="Zone name" error={errors.name}>
          <Input id={fid("name")} value={z.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id={fid("window")} label="Delivery window" help="For example: 7:00–8:30am">
          <Input
            id={fid("window")}
            value={z.delivery_window_label}
            onChange={(e) => set("delivery_window_label", e.target.value)}
          />
        </Field>
      </div>
      <Field
        id={fid("zips")}
        label="ZIP codes"
        help="Paste a list separated by commas or spaces."
        error={errors.zip_codes}
      >
        <textarea
          id={fid("zips")}
          rows={2}
          value={z.zip_codes}
          onChange={(e) => set("zip_codes", e.target.value)}
          className="w-full rounded-md border-2 border-ink bg-card px-3 py-2 font-mono text-sm"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={fid("fee")} label="Delivery fee" help={canEditFees ? undefined : "Owner only"}>
          {canEditFees ? (
            <MoneyInput id={fid("fee")} cents={z.fee_cents} onChange={(v) => set("fee_cents", v ?? 0)} />
          ) : (
            <p className="py-2 font-semibold">{formatCents(z.fee_cents)}</p>
          )}
        </Field>
        <Field id={fid("free")} label="Free delivery over" help="Empty = never free">
          {canEditFees ? (
            <MoneyInput
              id={fid("free")}
              cents={z.free_over_cents}
              allowEmpty
              onChange={(v) => set("free_over_cents", v)}
            />
          ) : (
            <p className="py-2 font-semibold">{formatCents(z.free_over_cents)}</p>
          )}
        </Field>
        <Field id={fid("min")} label="Minimum order">
          {canEditFees ? (
            <MoneyInput id={fid("min")} cents={z.min_order_cents} onChange={(v) => set("min_order_cents", v ?? 0)} />
          ) : (
            <p className="py-2 font-semibold">{formatCents(z.min_order_cents)}</p>
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 font-semibold">Delivery days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <ChipToggle
              key={d}
              pressed={z.delivery_weekdays.includes(i + 1)}
              onPressedChange={(on) =>
                set(
                  "delivery_weekdays",
                  on ? [...z.delivery_weekdays, i + 1].sort() : z.delivery_weekdays.filter((x) => x !== i + 1),
                )
              }
            >
              {d}
            </ChipToggle>
          ))}
        </div>
        {errors.delivery_weekdays ? (
          <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
            {errors.delivery_weekdays}
          </p>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <ChipToggle pressed={z.is_active} onPressedChange={(v) => set("is_active", v)}>
          {z.is_active ? "Active" : "Paused"}
        </ChipToggle>
        {dirty || !zone.id ? (
          <Button
            onClick={async () => {
              setErrors({});
              const r = await runWithStepUp(() => saveZone(z));
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.message);
              }
              toast.success(r.message);
              onDone?.();
              router.refresh();
            }}
          >
            {zone.id ? "Save zone" : "Create zone"}
          </Button>
        ) : null}
        {onDone ? (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </section>
  );
}
