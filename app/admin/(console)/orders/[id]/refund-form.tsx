"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/fields";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";

import { refreshPayment, refundOrder } from "../actions";

type Line = { id: string; label: string; paidCents: number };

/** Refund by line or by amount, with a reason. Asks for a fresh authenticator code. */
export function RefundForm({
  orderId,
  lines,
  refundableCents,
  limitCents,
}: {
  orderId: string;
  lines: Line[];
  refundableCents: number;
  limitCents: number | null;
}) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const fromLines = lines.filter((l) => picked.includes(l.id)).reduce((s, l) => s + l.paidCents, 0);
  const cents = picked.length ? fromLines : Math.round(Number(amount || 0) * 100);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm(`Refund ${formatCents(cents)} to the customer's card?`)) return;
        start(async () => {
          const r = await runWithStepUp(() =>
            refundOrder({ orderId, itemIds: picked, amountCents: picked.length ? undefined : cents, reason }),
          );
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setPicked([]);
          setAmount("");
          setReason("");
          router.refresh();
        });
      }}
    >
      {lines.length ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">Refund specific meals</legend>
          {lines.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(l.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))}
                className="size-4 accent-[var(--ink)]"
              />
              {l.label} · {formatCents(l.paidCents)}
            </label>
          ))}
        </fieldset>
      ) : null}
      {!picked.length ? (
        <Field
          id="refund-amount"
          label="…or an amount ($)"
          help={`Up to ${formatCents(refundableCents)} can still be refunded${limitCents !== null ? `; your limit is ${formatCents(limitCents)} per refund` : ""}.`}
        >
          <Input
            id="refund-amount"
            type="number"
            min={0.01}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="max-w-40"
          />
        </Field>
      ) : null}
      <Field id="refund-reason" label="Reason">
        <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending || cents <= 0 || reason.trim().length < 3}>
          Refund {cents > 0 ? formatCents(cents) : ""}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await refreshPayment({ orderId });
              if (!r.ok) toast.error(r.message);
              router.refresh();
            })
          }
        >
          Check with Stripe
        </Button>
      </div>
    </form>
  );
}
