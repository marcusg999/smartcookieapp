"use client";

import { Check, Copy, Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChipToggle, Field } from "@/components/admin/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createInvite, resolveFeedback, savePilotTargets, setHouseholdPilot, setPilotMode } from "./actions";

type Result = { ok: boolean; message?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved.");
      else toast.error(r.message ?? "Something went wrong.");
      router.refresh();
    });
  return { pending, run };
}

export function PilotModeToggle({ on }: { on: boolean }) {
  const { pending, run } = useRun();
  return (
    <ChipToggle pressed={on} onPressedChange={(v) => (pending ? undefined : run(() => setPilotMode({ on: v })))}>
      {on ? "Pilot mode on: invite code needed to sign up" : "Pilot mode off: anyone can sign up"}
    </ChipToggle>
  );
}

export function InviteForm() {
  const { pending, run } = useRun();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await createInvite({ email, note });
          if (r.ok) {
            setEmail("");
            setNote("");
          }
          return r;
        });
      }}
    >
      <Field id="invite-email" label="Family's email (optional)" help="We'll email them the code and a sign-up link.">
        <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id="invite-note" label="Note for you (optional)" help="e.g. “Priya, two kids, Maple Grove”.">
        <Input id="invite-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
        {email ? "Email invite" : "Create code"}
      </Button>
    </form>
  );
}

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-card px-2 py-0.5 font-mono text-sm font-bold hover:bg-accent"
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        toast.success(`Copied ${code}`);
      }}
      aria-label={`Copy invite code ${code}`}
    >
      {code}{" "}
      {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
    </button>
  );
}

export function HouseholdPilotToggle({ householdId, pilot }: { householdId: string; pilot: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => run(() => setHouseholdPilot({ householdId, pilot: !pilot }))}
    >
      {pilot ? "Remove from pilot" : "Add to pilot"}
    </Button>
  );
}

type Targets = {
  reorder_week2_pct: number;
  median_repeat_seconds: number;
  max_allergy_incidents: number;
  allergy_incidents_recorded: number;
};

export function TargetsForm({ targets }: { targets: Targets }) {
  const { pending, run } = useRun();
  const [t, setT] = useState(targets);
  const num = (k: keyof Targets, label: string, help: string, max: number) => (
    <Field id={`t-${k}`} label={label} help={help}>
      <Input
        id={`t-${k}`}
        type="number"
        min={0}
        max={max}
        value={t[k]}
        onChange={(e) => setT({ ...t, [k]: Math.max(0, Math.min(max, Number(e.target.value || 0))) })}
      />
    </Field>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePilotTargets(t));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {num("reorder_week2_pct", "Families who reorder in week 2 (%)", "Target: at least this share.", 100)}
        {num("median_repeat_seconds", "Median repeat order time (seconds)", "Target: under this.", 3600)}
        {num("max_allergy_incidents", "Allergy incidents allowed", "Target: no more than this (usually 0).", 100)}
        {num(
          "allergy_incidents_recorded",
          "Allergy incidents so far",
          "Record any real incident here (a child got a meal they shouldn't have).",
          1000,
        )}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save targets
      </Button>
    </form>
  );
}

export function ResolveButton({ id, resolved }: { id: string; resolved: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => run(() => resolveFeedback({ id, resolved: !resolved }))}
    >
      {resolved ? "Reopen" : "Mark handled"}
    </Button>
  );
}
