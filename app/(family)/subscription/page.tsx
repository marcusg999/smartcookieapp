import { PageTitle } from "@/components/family/kit";
import { SubscriptionPanel } from "@/components/family/subscription-panel";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getPublicSettings } from "@/lib/content/settings";
import { describePlan } from "@/lib/family/plan-copy";
import { getHousehold, getOrderableWeeks, getPlans, getSubscription } from "@/lib/family/queries";
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
  const sub = household ? await getSubscription(household.id) : null;
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
        plans={plans.map((p) => describePlan(p, c))}
        sub={
          sub
            ? {
                id: sub.id,
                planId: sub.plan.id,
                status: sub.status,
                statusLabel: c.text(`sub.status_${sub.status}`),
                pausedUntilLabel:
                  sub.paused_until && !isPast(sub.paused_until) ? c.text("sub.paused_until", { date: date(sub.paused_until) }) : null,
                cancelAtPeriodEnd: sub.cancel_at_period_end,
                nextBillLabel: sub.current_period_end ? c.text("sub.next_bill", { date: date(sub.current_period_end) }) : null,
                pendingPlanName: plans.find((p) => p.id === sub.pending_plan_id)?.name ?? null,
                allowPause: sub.plan.allow_pause,
              }
            : null
        }
        weeks={weeks.map((w) => ({
          id: w.id,
          label: formatDay(w.week_start, { weekday: "short", month: "short", day: "numeric" }),
          skipped: skipped.has(w.id),
          canSkip: Boolean(sub?.plan.allow_skip),
        }))}
        minPause={addDays(today, 7)}
        maxPause={addDays(today, 7 * 12)}
      />
    </div>
  );
}
