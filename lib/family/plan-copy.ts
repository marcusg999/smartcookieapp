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
    p.includes_snacks && p.snacks_per_interval ? c.text("plans.snacks_label", { count: String(p.snacks_per_interval) }) : null,
    p.allow_skip && p.max_skips_per_month ? c.text("plans.skip_label", { count: String(p.max_skips_per_month) }) : null,
    p.allow_pause ? c.text("plans.pause_label") : null,
    p.price_per_extra_meal_cents ? c.text("plans.extra_label", { price: formatCents(p.price_per_extra_meal_cents, p.currency) }) : null,
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
