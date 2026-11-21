"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { changePlan, changeSubscription, choosePlan, setWeekSkip } from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { fmt, type Copy } from "./kit";

export type PlanCard = {
  id: string;
  name: string;
  priceLabel: string;
  intervalLabel: string;
  points: string[];
};

type Sub = {
  id: string;
  planId: string;
  status: string;
  statusLabel: string;
  pausedUntilLabel: string | null;
  cancelAtPeriodEnd: boolean;
  nextBillLabel: string | null;
  pendingPlanName: string | null;
  allowPause: boolean;
};

export function SubscriptionPanel({
  copy,
  plans,
  sub,
  weeks,
  minPause,
  maxPause,
}: {
  copy: Copy;
  plans: PlanCard[];
  sub: Sub | null;
  weeks: { id: string; label: string; skipped: boolean; canSkip: boolean }[];
  minPause: string;
  maxPause: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [until, setUntil] = useState(minPause);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message ?? "");
      if (success) toast.success(success);
      router.refresh();
    });

  return (
    <div className="space-y-8">
      {sub ? (
        <section className="rounded-2xl border-2 border-ink bg-orange p-5 shadow-ink-lg">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase">{copy.current}</p>
              <h2 className="text-3xl font-black">{plans.find((p) => p.id === sub.planId)?.name}</h2>
              <p className="mt-1 font-semibold">
                {sub.statusLabel}
                {sub.nextBillLabel ? ` · ${sub.nextBillLabel}` : ""}
              </p>
              {sub.pausedUntilLabel ? <p className="font-semibold">{sub.pausedUntilLabel}</p> : null}
              {sub.cancelAtPeriodEnd ? <p className="font-semibold">{copy.canceling}</p> : null}
              {sub.pendingPlanName ? (
                <p className="font-semibold">{fmt(copy.change_pending, { plan: sub.pendingPlanName })}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {sub.pausedUntilLabel ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => changeSubscription({ subscriptionId: sub.id, action: "resume" }))}
                >
                  {copy.resume}
                </Button>
              ) : null}
              {sub.cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => run(() => changeSubscription({ subscriptionId: sub.id, action: "reactivate" }))}
                >
                  {copy.reactivate}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(copy.cancel_confirm))
                      run(() => changeSubscription({ subscriptionId: sub.id, action: "cancel" }));
                  }}
                >
                  {copy.cancel}
                </Button>
              )}
            </div>
          </div>
          {sub.allowPause && !sub.pausedUntilLabel ? (
            <form
              className="mt-4 flex flex-wrap items-end gap-2 border-t-2 border-ink pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => changeSubscription({ subscriptionId: sub.id, action: "pause", until }));
              }}
            >
              <label className="flex flex-col gap-1 text-sm font-semibold">
                {copy.pause_until}
                <Input
                  type="date"
                  value={until}
                  min={minPause}
                  max={maxPause}
                  onChange={(e) => setUntil(e.target.value)}
                  className="bg-paper"
                />
              </label>
              <Button type="submit" variant="outline" disabled={pending}>
                {copy.pause}
              </Button>
            </form>
          ) : null}
        </section>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-ink bg-paper p-4 font-semibold">{copy.none}</p>
      )}

      {sub && weeks.length ? (
        <section aria-labelledby="weeks-h">
          <h2 id="weeks-h" className="mb-3 text-2xl font-black">
            {copy.skip_title}
          </h2>
          <ul className="space-y-2">
            {weeks.map((w) => (
              <li key={w.id} className="flex items-center justify-between rounded-xl border-2 border-ink bg-paper p-3">
                <span className={cn("font-semibold", w.skipped && "line-through")}>{w.label}</span>
                {w.canSkip ? (
                  <Button
                    size="sm"
                    variant={w.skipped ? "secondary" : "outline"}
                    disabled={pending}
                    onClick={() => run(() => setWeekSkip({ subscriptionId: sub.id, weekId: w.id, skip: !w.skipped }))}
                  >
                    {w.skipped ? copy.unskip_week : copy.skip_week}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="plans-h">
        <h2 id="plans-h" className="mb-3 text-2xl font-black">
          {copy.choose}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {plans.map((p, i) => {
            const current = sub?.planId === p.id;
            return (
              <li
                key={p.id}
                className={cn(
                  "flex flex-col rounded-2xl border-2 border-ink bg-paper p-5 shadow-ink transition-transform hover:-translate-y-1",
                  i === 1 && "md:-translate-y-2 md:rotate-[0.6deg]",
                  current && "ring-4 ring-orange",
                )}
              >
                <h3 className="text-xl font-black">{p.name}</h3>
                <p className="mt-2 text-3xl font-black">
                  {p.priceLabel} <span className="text-sm font-semibold">{p.intervalLabel}</span>
                </p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {pt}
                    </li>
                  ))}
                </ul>
                {current ? (
                  <span className="mt-4 rounded-md border-2 border-ink bg-orange-tint py-2 text-center font-bold">
                    {copy.current}
                  </span>
                ) : (
                  <Button
                    className="mt-4"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          sub ? changePlan({ subscriptionId: sub.id, planId: p.id }) : choosePlan({ planId: p.id }),
                        sub ? undefined : copy.started,
                      )
                    }
                  >
                    {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                    {sub ? copy.change : copy.start}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{copy.billing_note}</p>
      </section>
    </div>
  );
}
