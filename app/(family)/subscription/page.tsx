import { PageTitle } from "@/components/family/kit";
import { SubscriptionPanel } from "@/components/family/subscription-panel";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getPublicSettings } from "@/lib/content/settings";
import { describePlan, renewalTerms } from "@/lib/family/plan-copy";
import { getChildren, getHousehold, getOrderableWeeks, getPlans, getSubscription } from "@/lib/family/queries";
import { publicEnv } from "@/lib/env.public";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDay, formatInZone, isPast, todayInZone } from "@/lib/time";

export const metadata = { title: "Subscription" };

export default async function SubscriptionPage() {
  await requireUser("/subscription");
  const [c, settings, household, plans, weeks] = await Promise.all([
    getContent(),
    getPublicSettings().catch(() => null),
    getHousehold(),
    getPlans(),
    getOrderableWeeks(),
  ]);
  const tz = settings?.timezone ?? "America/Los_Angeles";
  const [sub, kids] = household
    ? await Promise.all([getSubscription(household.id), getChildren(household.id)])
    : [null, []];
  const supabase = await createClient();
  const { data: allowances } = sub
    ? await supabase.from("subscription_allowances").select("menu_week_id, skipped").eq("subscription_id", sub.id)
    : { data: [] };
  const skipped = new Set((allowances ?? []).filter((a) => a.skipped).map((a) => a.menu_week_id as string));
  const today = todayInZone(tz);
  const date = (iso: string | null) => (iso ? formatInZone(iso, tz, { month: "short", day: "numeric" }) : "");

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageTitle>{c.text("sub.title")}</PageTitle>
      <SubscriptionPanel
        copy={{ ...c.group("sub."), skip_week: c.text("order.skip_week"), unskip_week: c.text("order.unskip_week") }}
        plans={plans.map((p) => ({
          ...describePlan(p, c),
          renewalTerms: renewalTerms(p, c, kids.length, settings?.contact_email ?? null),
        }))}
        sub={
          sub
            ? {
                id: sub.id,
                planId: sub.plan.id,
                status: sub.status,
                statusLabel: c.text(`sub.status_${sub.status}`),
                pausedUntilLabel:
                  sub.paused_until && !isPast(sub.paused_until)
                    ? c.text("sub.paused_until", { date: date(sub.paused_until) })
                    : null,
                cancelAtPeriodEnd: sub.cancel_at_period_end,
                nextBillLabel: sub.current_period_end
                  ? c.text("sub.next_bill", { date: date(sub.current_period_end) })
                  : null,
                pendingPlanName: plans.find((p) => p.id === sub.pending_plan_id)?.name ?? null,
                allowPause: sub.plan.allow_pause,
                quantity: sub.quantity,
                perChild: sub.plan.allowance_unit === "per_child",
                pastDue: ["past_due", "unpaid"].includes(sub.status) || Boolean(sub.payment_failed_at),
              }
            : null
        }
        weeks={weeks.map((w) => ({
          id: w.id,
          label: formatDay(w.week_start, { weekday: "short", month: "short", day: "numeric" }),
          skipped: skipped.has(w.id),
          canSkip: Boolean(sub?.plan.allow_skip),
        }))}
        kidsCount={kids.length}
        checkoutCopy={c.group("checkout.")}
        returnUrl={new URL("/subscription", publicEnv.NEXT_PUBLIC_SITE_URL).toString()}
        hasStripeCustomer={Boolean(household?.stripe_customer_id)}
        minPause={addDays(today, 7)}
        maxPause={addDays(today, 7 * 12)}
      />
    </div>
  );
}
