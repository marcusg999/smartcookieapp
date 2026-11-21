"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field, formatCents, MoneyInput } from "@/components/admin/fields";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { addAccountCredit, addCustomerNote } from "../actions";

type Note = { id: string; body: string; created_at: string };
type Credit = { id: string; amount_cents: number; reason: string; created_at: string };
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "America/Los_Angeles" });

export function CustomerTools({ householdId, notes, credits }: { householdId: string; notes: Note[]; credits: Credit[] }) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const card = "space-y-3 rounded-2xl border-2 border-ink bg-paper p-5";

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className={card} aria-labelledby="notes">
        <h2 id="notes" className="text-xl font-bold">Notes</h2>
        <Field id="note" label="Add a private note (staff only)">
          <textarea id="note" value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border-2 border-ink bg-card p-2" />
        </Field>
        <Button disabled={busy || !note.trim()} onClick={async () => {
          setBusy(true);
          const r = await addCustomerNote({ householdId, body: note });
          setBusy(false);
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setNote("");
          router.refresh();
        }}>Add note</Button>
        <ul className="space-y-2">
          {notes.map((n) => <li key={n.id} className="rounded-lg border border-ink/20 p-2 text-sm"><span className="block text-xs text-muted-foreground">{fmt(n.created_at)}</span>{n.body}</li>)}
        </ul>
      </section>
      <section className={card} aria-labelledby="credits">
        <h2 id="credits" className="text-xl font-bold">Account credit</h2>
        <p className="text-sm text-muted-foreground">Use a negative amount to remove credit. Asks for your authenticator code.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="credit-amt" label="Amount"><MoneyInput id="credit-amt" cents={amount} onChange={(c) => setAmount(c ?? 0)} allowNegative /></Field>
          <Field id="credit-reason" label="Reason"><Input id="credit-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Late delivery on Oct 12" /></Field>
        </div>
        <Button disabled={busy || !amount || reason.trim().length < 3} onClick={async () => {
          setBusy(true);
          const r = await runWithStepUp(() => addAccountCredit({ householdId, amount_cents: amount, reason }));
          setBusy(false);
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setAmount(0);
          setReason("");
          router.refresh();
        }}>Add credit</Button>
        <ul className="space-y-1 text-sm">
          {credits.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{fmt(c.created_at)} · {c.reason}</span><span className="font-semibold">{formatCents(c.amount_cents)}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
