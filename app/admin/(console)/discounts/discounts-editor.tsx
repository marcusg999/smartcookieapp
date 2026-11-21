"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ChipToggle, Field, formatCents, MoneyInput } from "@/components/admin/fields";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fromZonedInput, toZonedInput } from "@/lib/time";

import { saveDiscount, setDiscountActive } from "./actions";

type Code = {
  id?: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  max_redemptions: number | null;
  times_redeemed?: number;
  expires_at: string | null;
  is_active: boolean;
};
const TZ = "America/Los_Angeles";

export function DiscountsEditor({ codes }: { codes: Code[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {codes.map((c) => (
        <CodeCard key={c.id} code={c} />
      ))}
      {adding ? (
        <CodeCard
          code={{ code: "", type: "percent", value: 10, max_redemptions: null, expires_at: null, is_active: true }}
          onDone={() => setAdding(false)}
        />
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" /> New code
        </Button>
      )}
    </div>
  );
}

function CodeCard({ code, onDone }: { code: Code; onDone?: () => void }) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const [c, setC] = useState(code);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(c) !== JSON.stringify(code);
  const fid = (k: string) => `${code.id ?? "new"}-${k}`;
  const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
  return (
    <section className="space-y-3 rounded-2xl border-2 border-ink bg-paper p-4" aria-label={c.code || "New code"}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id={fid("code")} label="Code" error={errors.code}>
          <Input
            id={fid("code")}
            value={c.code}
            onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })}
            className="font-mono"
          />
        </Field>
        <Field id={fid("type")} label="Type">
          <select
            id={fid("type")}
            value={c.type}
            onChange={(e) =>
              setC({ ...c, type: e.target.value as Code["type"], value: e.target.value === "percent" ? 10 : 500 })
            }
            className="h-11 w-full rounded-md border-2 border-ink bg-card px-3"
          >
            <option value="percent">Percent off</option>
            <option value="fixed">Amount off</option>
          </select>
        </Field>
        <Field id={fid("val")} label={c.type === "percent" ? "Percent" : "Amount"} error={errors.value}>
          {c.type === "percent" ? (
            <Input
              id={fid("val")}
              type="number"
              min={1}
              max={100}
              value={c.value}
              onChange={(e) => setC({ ...c, value: Number(e.target.value) })}
            />
          ) : (
            <MoneyInput
              key={`${c.type}`}
              id={fid("val")}
              cents={c.value}
              onChange={(v) => setC({ ...c, value: v ?? 0 })}
            />
          )}
        </Field>
        <Field id={fid("max")} label="Max uses" help="Blank = unlimited">
          <Input
            id={fid("max")}
            type="number"
            min={1}
            value={c.max_redemptions ?? ""}
            onChange={(e) => setC({ ...c, max_redemptions: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field id={fid("exp")} label="Expires (optional)">
          <Input
            id={fid("exp")}
            type="datetime-local"
            value={c.expires_at ? toZonedInput(c.expires_at, TZ) : ""}
            onChange={(e) => setC({ ...c, expires_at: e.target.value ? fromZonedInput(e.target.value, TZ) : null })}
          />
        </Field>
        <ChipToggle
          pressed={c.is_active}
          onPressedChange={async (v) => {
            if (!code.id || dirty) return setC({ ...c, is_active: v });
            const r = await setDiscountActive({ id: code.id, is_active: v });
            if (!r.ok) return void toast.error(r.message);
            toast.success(r.message);
            router.refresh();
          }}
        >
          {c.is_active ? "On" : "Off"}
        </ChipToggle>
        <span className="text-sm text-muted-foreground">
          {c.type === "percent" ? `${c.value}% off` : `${formatCents(c.value)} off`}
          {code.id
            ? ` · used ${code.times_redeemed ?? 0}${c.max_redemptions ? ` of ${c.max_redemptions}` : ""} times`
            : ""}
          {expired ? " · expired" : ""}
        </span>
        <Button
          className="ml-auto"
          disabled={!dirty}
          onClick={async () => {
            const { times_redeemed: _t, ...payload } = c;
            const r = await runWithStepUp(() => saveDiscount(payload));
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return void toast.error(r.message);
            }
            setErrors({});
            toast.success(r.message);
            onDone?.();
            router.refresh();
          }}
        >
          Save
        </Button>
      </div>
    </section>
  );
}
