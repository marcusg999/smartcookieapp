"use client";

import { Check, CreditCard, Loader2, TriangleAlert, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  changePlan,
  changeSubscription,
  choosePlan,
  openBillingPortal,
  planStatus,
  setWeekSkip,
  syncPlanQuantity,
} from "@/app/(family)/actions";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { fmt, type Copy } from "./kit";
import { StripePayment } from "./stripe-payment";

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
  quantity: number;
  perChild: boolean;
  pastDue: boolean;
};

export function SubscriptionPanel({
  copy,
  plans,
  sub,
  weeks,
  minPause,
  maxPause,
  kidsCount,
  checkoutCopy,
  returnUrl,
  hasStripeCustomer,
}: {
  copy: Copy;
  plans: PlanCard[];
  sub: Sub | null;
  weeks: { id: string; label: string; skipped: boolean; canSkip: boolean }[];
  minPause: string;
  maxPause: string;
  kidsCount: number;
  checkoutCopy: Copy;
  returnUrl: string;
  hasStripeCustomer: boolean;
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

  const [pay, setPay] = useState<{ clientSecret: string; amountCents: number } | null>(null);
  const [processing, setProcessing] = useState(false);

  const startPlan = (planId: string) =>
    start(async () => {
      const res = await choosePlan({ planId });
      if (!res.ok) return void toast.error(res.message);
      if (res.data?.kind === "client_secret") {
        setPay({ clientSecret: res.data.clientSecret!, amountCents: res.data.amountCents! });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        toast.success(copy.started);
        router.refresh();
      }
    });

  const billing = () =>
    start(async () => {
      const res = await openBillingPortal();
      if (!res.ok) return void toast.error(res.message);
      if (res.data?.url) window.location.assign(res.data.url);
    });

  // After the first payment: wait for Stripe's webhook to activate the plan.
  useEffect(() => {
    if (!processing) return;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      const res = await planStatus();
      const active = res.ok && res.data?.status === "active";
      if (active || tries > 40) {
        clearInterval(id);
        setProcessing(false);
        setPay(null);
        if (active) toast.success(copy.started);
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(id);
  }, [processing, router, copy.started]);

  return (
    <div className="space-y-8">
      {pay ? (
        <section aria-labelledby="pay-h" className="rounded-2xl border-2 border-ink bg-paper p-6 shadow-ink-lg">
          {processing ? (
            <div role="status" className="text-center">
              <Loader2 aria-hidden="true" className="mx-auto size-10 animate-spin" />
              <h2 id="pay-h" className="mt-3 text-2xl font-black">
                {copy.processing}
              </h2>
            </div>
          ) : (
            <>
              <h2 id="pay-h" className="text-3xl font-black">
                {copy.pay_title}
              </h2>
              <p className="mt-2">{fmt(copy.pay_body, { amount: formatCents(pay.amountCents) })}</p>
              <div className="mt-5">
                <StripePayment
                  clientSecret={pay.clientSecret}
                  amountLabel={fmt(checkoutCopy.pay_button, { amount: formatCents(pay.amountCents) })}
                  returnUrl={returnUrl}
                  copy={checkoutCopy}
                  onConfirmed={() => setProcessing(true)}
                />
              </div>
            </>
          )}
        </section>
      ) : null}
      {sub?.pastDue ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-destructive bg-paper p-4">
          <p className="flex items-center gap-2 font-bold text-destructive">
            <TriangleAlert aria-hidden="true" className="size-5" /> {copy.past_due_banner}
          </p>
          <Button variant="destructive" disabled={pending} onClick={billing}>
            {copy.update_card}
          </Button>
        </div>
      ) : null}
      {sub && sub.perChild && sub.quantity !== kidsCount && kidsCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-orange-tint p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Users aria-hidden="true" className="size-5" /> {fmt(copy.quantity_mismatch, { count: sub.quantity, kids: kidsCount })}
          </p>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (confirm(copy.quantity_explain)) run(() => syncPlanQuantity({ subscriptionId: sub.id }));
            }}
          >
            {fmt(copy.sync_quantity, { kids: kidsCount })}
          </Button>
        </div>
      ) : null}
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
                    onClick={() =>
                      start(async () => {
                        const res = await setWeekSkip({ subscriptionId: sub.id, weekId: w.id, skip: !w.skipped });
                        if (!res.ok) return void toast.error(res.message);
                        const cents = res.data?.creditCents ?? 0;
                        if (cents > 0) toast.success(fmt(copy.skip_credit, { amount: formatCents(cents) }));
                        if (cents < 0) toast.success(fmt(copy.unskip_debit, { amount: formatCents(-cents) }));
                        router.refresh();
                      })
                    }
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
                    onClick={() => {
                      if (!sub) return startPlan(p.id);
                      if (confirm(copy.change_explain)) run(() => changePlan({ subscriptionId: sub.id, planId: p.id }));
                    }}
                  >
                    {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                    {sub ? copy.change : copy.start}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {hasStripeCustomer ? (
            <Button variant="outline" disabled={pending} onClick={billing}>
              <CreditCard aria-hidden="true" /> {copy.manage_billing}
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">{copy.billing_note}</p>
        </div>
      </section>
    </div>
  );
}
