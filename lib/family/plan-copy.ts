import "server-only";

import type { Content } from "@/lib/content/content";
import { formatCents } from "@/lib/money";
import { weeklyShare } from "@/lib/ordering/logic";

import type { Plan } from "./queries";

/** A plan described for a parent, every word from the CMS. Shared by /plans and /subscription. */
export function describePlan(p: Plan, c: Content) {
  const interval =
    p.billing_interval === "week"
      ? c.text("home.plans.per_week")
      : p.billing_interval === "month"
        ? c.text("home.plans.per_month")
        : c.text("home.plans.per_two_weeks");
  const points = [
    `${c.text("plans.meals_label", { count: String(p.meals_per_interval) })} ${p.allowance_unit === "per_child" ? c.text("plans.per_child") : c.text("plans.per_household")}`,
    p.includes_snacks && p.snacks_per_interval
      ? c.text("plans.snacks_label", { count: String(p.snacks_per_interval) })
      : null,
    p.allow_skip && p.max_skips_per_month ? c.text("plans.skip_label", { count: String(p.max_skips_per_month) }) : null,
    p.allow_pause ? c.text("plans.pause_label") : null,
    p.price_per_extra_meal_cents
      ? c.text("plans.extra_label", { price: formatCents(p.price_per_extra_meal_cents, p.currency) })
      : null,
  ].filter((x): x is string => Boolean(x));
  return {
    id: p.id,
    name: p.name,
    priceLabel: formatCents(p.price_cents, p.currency),
    intervalLabel: interval,
    points,
    weeklyMeals: weeklyShare(p.meals_per_interval, p.billing_interval),
  };
}

/**
 * California Automatic Renewal Law (Bus. & Prof. Code §17602) disclosure for
 * a plan: that it renews until cancelled, how much and how often, any trial
 * or minimum term, and how to cancel. Shown next to "Start this plan" and
 * stored with the parent's consent (the same text goes in the "plan started"
 * email). Built on the server from the plan row and CMS wording, never from
 * anything the browser sends.
 */
export function renewalTerms(p: Plan, c: Content, kids: number, contactEmail: string | null): string {
  const qty = p.allowance_unit === "per_child" ? Math.max(1, kids) : 1;
  const amount = formatCents(p.price_cents * qty, p.currency);
  const every = c.text(`sub.arl_every_${p.billing_interval}`);
  return [
    c.text("sub.arl_renews", { amount, every }),
    qty > 1 ? c.text("sub.arl_per_child", { price: formatCents(p.price_cents, p.currency), count: String(qty) }) : "",
    p.trial_intervals > 0 ? c.text("sub.arl_trial", { count: String(p.trial_intervals), amount }) : "",
    p.min_commitment_intervals > 0 ? c.text("sub.arl_min_term", { count: String(p.min_commitment_intervals) }) : "",
    c.text("sub.arl_cancel", { email: contactEmail ?? "" }),
  ]
    .filter(Boolean)
    .join(" ");
}
