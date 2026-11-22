import "server-only";

import { cache } from "react";

import { getUser } from "@/lib/auth/guards";
import { getPublishedWeeks, type PublicWeek } from "@/lib/menu/queries";
import type { CartLine, ChildAllergy, PlanAllowance, Severity, ZoneFees } from "@/lib/ordering/logic";
import { createClient } from "@/lib/supabase/server";

/**
 * Family reads. Every query runs with the parent's own session, so RLS
 * decides what comes back (CLAUDE.md §5.1). Cached per request.
 */

export type Household = {
  id: string;
  name: string;
  onboarded_at: string | null;
  ordering_preference: "a_la_carte" | "subscription" | null;
  preferred_plan_id: string | null;
  default_address_id: string | null;
  stripe_customer_id: string | null;
};

export type Child = {
  id: string;
  first_name: string;
  last_initial: string | null;
  school_id: string | null;
  classroom_id: string | null;
  grade: string | null;
  dietary_preferences: string[];
  notes: string | null;
  allergies: (ChildAllergy & { allergenId: string })[];
  overrides: string[];
};

export type Address = {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  delivery_notes: string | null;
  is_default: boolean;
};

export type Zone = ZoneFees & {
  id: string;
  name: string;
  deliveryWeekdays: number[];
  windowLabel: string | null;
};

export type Plan = {
  id: string;
  name: string;
  slug: string;
  description_rich: unknown;
  billing_interval: "week" | "two_weeks" | "month";
  meals_per_interval: number;
  allowance_unit: "per_child" | "per_household";
  price_cents: number;
  price_per_extra_meal_cents: number | null;
  currency: string;
  includes_snacks: boolean;
  snacks_per_interval: number;
  allow_skip: boolean;
  max_skips_per_month: number;
  allow_pause: boolean;
  auto_fill_strategy: "favorites" | "chefs_choice" | "none";
  min_commitment_intervals: number;
  trial_intervals: number;
};

export type Subscription = {
  id: string;
  status: string;
  quantity: number;
  payment_failed_at: string | null;
  paused_until: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  pending_plan_id: string | null;
  plan: Plan;
};

export const PLAN_COLUMNS = `id, name, slug, description_rich, billing_interval, meals_per_interval, allowance_unit, price_cents,
  price_per_extra_meal_cents, currency, includes_snacks, snacks_per_interval, allow_skip, max_skips_per_month, allow_pause,
  auto_fill_strategy, min_commitment_intervals, trial_intervals`;

export const getHousehold = cache(async (): Promise<Household | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!member) return null;
  const { data } = await supabase
    .from("households")
    .select("id, name, onboarded_at, ordering_preference, preferred_plan_id, default_address_id, stripe_customer_id")
    .eq("id", member.household_id)
    .maybeSingle();
  return (data as Household | null) ?? null;
});

export const getChildren = cache(async (householdId: string): Promise<Child[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("children")
    .select(
      `id, first_name, last_initial, school_id, classroom_id, grade, dietary_preferences, notes,
       child_allergens ( severity, allergen_id, allergens ( name, sort_order ) ),
       allergy_overrides ( menu_item_id, revoked_at )`,
    )
    .eq("household_id", householdId)
    .is("archived_at", null)
    .order("created_at");
  type Row = Omit<Child, "allergies" | "overrides"> & {
    child_allergens: {
      severity: Severity;
      allergen_id: string;
      allergens: { name: string; sort_order: number } | null;
    }[];
    allergy_overrides: { menu_item_id: string; revoked_at: string | null }[];
  };
  return ((data ?? []) as unknown as Row[]).map(({ child_allergens, allergy_overrides, ...c }) => ({
    ...c,
    allergies: child_allergens
      .filter((a) => a.allergens)
      .sort((a, b) => a.allergens!.sort_order - b.allergens!.sort_order)
      .map((a) => ({ allergen: a.allergens!.name, severity: a.severity, allergenId: a.allergen_id })),
    overrides: allergy_overrides.filter((o) => !o.revoked_at).map((o) => o.menu_item_id),
  }));
});

export const getAllergens = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("allergens")
    .select("id, name, slug, is_top9, icon, sort_order")
    .order("sort_order");
  return (data ?? []) as { id: string; name: string; slug: string; is_top9: boolean; icon: string | null }[];
});

export const getDietaryBadges = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("dietary_badges").select("id, name, slug").order("sort_order");
  return (data ?? []) as { id: string; name: string; slug: string }[];
});

export const getAddresses = cache(async (householdId: string): Promise<Address[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("addresses")
    .select("id, line1, line2, city, state, zip, delivery_notes, is_default")
    .eq("household_id", householdId)
    .order("is_default", { ascending: false })
    .order("created_at");
  return (data ?? []) as Address[];
});

export const getZoneForZip = cache(async (zip: string): Promise<Zone | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("zone_for_zip", { p_zip: zip });
  const z = (data as Record<string, unknown>[] | null)?.[0];
  if (!z) return null;
  return {
    id: z.zone_id as string,
    name: z.name as string,
    deliveryWeekdays: (z.delivery_weekdays as number[]) ?? [],
    windowLabel: (z.delivery_window_label as string | null) ?? null,
    feeCents: z.fee_cents as number,
    freeOverCents: (z.free_over_cents as number | null) ?? null,
    minOrderCents: z.min_order_cents as number,
  };
});

export const getPlans = cache(async (): Promise<Plan[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("plans").select(PLAN_COLUMNS).eq("audience", "family").order("sort_order");
  return (data ?? []) as Plan[];
});

export const getSubscription = cache(async (householdId: string): Promise<Subscription | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select(
      `id, status, quantity, payment_failed_at, paused_until, cancel_at_period_end, current_period_end, pending_plan_id, plans ( ${PLAN_COLUMNS} )`,
    )
    .eq("household_id", householdId)
    .in("status", ["active", "trialing", "past_due", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { plans, ...rest } = data as unknown as Omit<Subscription, "plan"> & { plans: Plan };
  return { ...rest, plan: plans };
});

/** The subscription's allowance for a week (skipped? how many used?). */
export async function getAllowance(subscriptionId: string, weekId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscription_allowances")
    .select("skipped, meals_allowed, meals_used, snacks_allowed, snacks_used")
    .eq("subscription_id", subscriptionId)
    .eq("menu_week_id", weekId)
    .maybeSingle();
  return data as {
    skipped: boolean;
    meals_allowed: number;
    meals_used: number;
    snacks_allowed: number;
    snacks_used: number;
  } | null;
}

/** Plan in the shape priceCart understands; null when nothing is included right now. */
export function toPlanAllowance(sub: Subscription | null, skipped: boolean): PlanAllowance | null {
  if (!sub || !["active", "trialing"].includes(sub.status)) return null;
  if (sub.paused_until && Date.parse(sub.paused_until) > Date.now()) return null;
  return {
    mealsPerInterval: sub.plan.meals_per_interval,
    snacksPerInterval: sub.plan.snacks_per_interval,
    includesSnacks: sub.plan.includes_snacks,
    interval: sub.plan.billing_interval,
    unit: sub.plan.allowance_unit,
    skipped,
  };
}

export async function getCart(householdId: string, weekId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("carts")
    .select("lines, replaces_order_id, updated_at")
    .eq("household_id", householdId)
    .eq("menu_week_id", weekId)
    .maybeSingle();
  type Raw = { child_id: string; menu_item_id: string; delivery_date: string; quantity: number };
  const lines: CartLine[] = ((data?.lines ?? []) as Raw[]).map((l) => ({
    childId: l.child_id,
    menuItemId: l.menu_item_id,
    deliveryDate: l.delivery_date,
    quantity: l.quantity,
  }));
  return { lines, replacesOrderId: (data?.replaces_order_id as string | null) ?? null };
}

export const getFavorites = cache(async (householdId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("favorites")
    .select("id, child_id, menu_item_id, menu_items ( name, menu_categories ( name ) )")
    .eq("household_id", householdId)
    .order("created_at");
  return (
    (data ?? []) as unknown as {
      id: string;
      child_id: string | null;
      menu_item_id: string;
      menu_items: { name: string; menu_categories: { name: string } | null } | null;
    }[]
  ).map((f) => ({
    id: f.id,
    childId: f.child_id,
    menuItemId: f.menu_item_id,
    name: f.menu_items?.name ?? "",
    category: f.menu_items?.menu_categories?.name ?? null,
  }));
});

export const getSavedOrders = cache(async (householdId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("saved_orders")
    .select("id, name, payload, updated_at")
    .eq("household_id", householdId)
    .order("updated_at", { ascending: false });
  return (data ?? []) as {
    id: string;
    name: string;
    payload: { child_id: string; menu_item_id: string; quantity: number; weekday: number }[];
  }[];
});

export type OrderSummary = {
  id: string;
  order_number: string;
  status: string;
  source: string;
  fulfillment: string;
  menu_week_id: string;
  total_cents: number;
  currency: string;
  placed_at: string | null;
  week_start: string;
  cutoff: string | null;
  item_count: number;
};

export const getOrders = cache(async (householdId: string): Promise<OrderSummary[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, source, fulfillment, menu_week_id, total_cents, currency, placed_at, menu_weeks ( week_start ), order_items ( quantity )",
    )
    .eq("household_id", householdId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(60);
  type Row = Omit<OrderSummary, "week_start" | "cutoff" | "item_count"> & {
    menu_weeks: { week_start: string } | null;
    order_items: { quantity: number }[];
  };
  const rows = (data ?? []) as unknown as Row[];
  const weekIds = [...new Set(rows.map((r) => r.menu_week_id))];
  const cutoffs = new Map<string, string | null>();
  await Promise.all(
    weekIds.map(async (id) => {
      const { data: c } = await supabase.rpc("menu_week_cutoff", { p_week: id });
      cutoffs.set(id, (c as string | null) ?? null);
    }),
  );
  return rows.map(({ menu_weeks, order_items, ...o }) => ({
    ...o,
    week_start: menu_weeks?.week_start ?? "",
    cutoff: cutoffs.get(o.menu_week_id) ?? null,
    item_count: order_items.reduce((n, i) => n + i.quantity, 0),
  }));
});

export type OrderDetail = {
  id: string;
  order_number: string;
  status: string;
  source: string;
  fulfillment: "delivery" | "school_dropoff";
  menu_week_id: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  credit_cents: number;
  amount_paid_cents: number;
  amount_refunded_cents: number;
  last_payment_error: string | null;
  currency: string;
  placed_at: string | null;
  allergy_confirmed_at: string | null;
  address_snapshot: { line1: string; line2?: string | null; city: string; state: string; zip: string } | null;
  notes: string | null;
  items: {
    id: string;
    child_id: string | null;
    menu_item_id: string | null;
    delivery_date: string | null;
    quantity: number;
    unit_price_cents: number;
    item_name: string;
    allergens_contained: string[];
    may_contain: string[];
    covered_by_subscription: boolean;
  }[];
};

export async function getOrder(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, source, fulfillment, menu_week_id, subtotal_cents, delivery_fee_cents, discount_cents, tax_cents,
       total_cents, currency, placed_at, allergy_confirmed_at, address_snapshot, notes, credit_cents, amount_paid_cents,
       amount_refunded_cents, last_payment_error,
       order_items ( id, child_id, menu_item_id, delivery_date, quantity, unit_price_cents, item_name, allergens_contained, may_contain, covered_by_subscription )`,
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return null;
  const { order_items, ...o } = data as unknown as Omit<OrderDetail, "items"> & { order_items: OrderDetail["items"] };
  return {
    ...o,
    items: [...order_items].sort((a, b) => (a.delivery_date ?? "").localeCompare(b.delivery_date ?? "")),
  };
}

/** The household's live order for a week, if any (one per week keeps things simple for parents). */
export async function getWeekOrder(householdId: string, weekId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, order_number, status, total_cents")
    .eq("household_id", householdId)
    .eq("menu_week_id", weekId)
    .in("status", ["pending_payment", "paid", "invoiced", "fulfilled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; order_number: string; status: string; total_cents: number } | null;
}

/** Weeks a family can order right now (published, open, before cutoff), soonest first. */
export async function getOrderableWeeks(now = new Date()): Promise<PublicWeek[]> {
  const weeks = await getPublishedWeeks().catch(() => []);
  return weeks.filter(
    (w) =>
      w.cutoff !== null &&
      Date.parse(w.cutoff) > now.getTime() &&
      (!w.ordering_opens_at || Date.parse(w.ordering_opens_at) <= now.getTime()),
  );
}

/** Last week's lines for "Repeat last week": the most recent live order before this week. */
export async function getLastOrderLines(householdId: string, beforeWeekStart: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, menu_weeks!inner ( week_start ), order_items ( child_id, menu_item_id, delivery_date, quantity, item_name, menu_items ( is_snack, menu_categories ( name ) ) )",
    )
    .eq("household_id", householdId)
    .in("status", ["pending_payment", "paid", "invoiced", "fulfilled"])
    .lt("menu_weeks.week_start", beforeWeekStart)
    .order("created_at", { ascending: false })
    .limit(10);
  type Row = {
    menu_weeks: { week_start: string };
    order_items: {
      child_id: string | null;
      menu_item_id: string | null;
      delivery_date: string | null;
      quantity: number;
      item_name: string;
      menu_items: { is_snack: boolean; menu_categories: { name: string } | null } | null;
    }[];
  };
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) =>
    b.menu_weeks.week_start.localeCompare(a.menu_weeks.week_start),
  );
  const latest = rows[0];
  if (!latest) return null;
  const weekStart = latest.menu_weeks.week_start;
  const lines = rows
    .filter((r) => r.menu_weeks.week_start === weekStart)
    .flatMap((r) => r.order_items)
    .filter((i) => i.child_id && i.menu_item_id && i.delivery_date)
    .map((i) => ({
      childId: i.child_id!,
      menuItemId: i.menu_item_id!,
      deliveryDate: i.delivery_date!,
      quantity: i.quantity,
      name: i.item_name,
      category: i.menu_items?.menu_categories?.name ?? null,
      isSnack: i.menu_items?.is_snack ?? false,
    }));
  // Covered + paid splits of one pick are separate rows; merge them back.
  const merged = new Map<string, (typeof lines)[number]>();
  for (const l of lines) {
    const key = `${l.childId}|${l.menuItemId}|${l.deliveryDate}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, quantity: prev.quantity + l.quantity } : l);
  }
  return { weekStart, lines: [...merged.values()] };
}

export async function getProfile(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle();
  return data as { full_name: string | null; phone: string | null } | null;
}

/** Partner schools + classrooms a child can be linked to (names only). */
export const getPartnerSchools = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("partner_schools");
  return (data ?? []) as {
    organization_id: string;
    name: string;
    classroom_id: string;
    classroom_name: string;
    grade: string | null;
  }[];
});

/** Plan allowance already used this week by the household's other live orders. */
export async function getUsedElsewhere(
  householdId: string,
  weekId: string,
  plan: PlanAllowance | null,
  excludeOrderId?: string | null,
) {
  const used = { meals: {} as Record<string, number>, snacks: {} as Record<string, number> };
  if (!plan) return used;
  const supabase = await createClient();
  let q = supabase
    .from("order_items")
    .select("child_id, quantity, menu_items ( is_snack ), orders!inner ( household_id, menu_week_id, status, id )")
    .eq("covered_by_subscription", true)
    .eq("orders.household_id", householdId)
    .eq("orders.menu_week_id", weekId)
    .in("orders.status", ["pending_payment", "paid", "invoiced", "fulfilled"]);
  if (excludeOrderId) q = q.neq("orders.id", excludeOrderId);
  const { data } = await q;
  for (const row of (data ?? []) as unknown as {
    child_id: string | null;
    quantity: number;
    menu_items: { is_snack: boolean } | null;
  }[]) {
    const key = plan.unit === "per_child" ? (row.child_id ?? "household") : "household";
    const bucket = row.menu_items?.is_snack ? used.snacks : used.meals;
    bucket[key] = (bucket[key] ?? 0) + row.quantity;
  }
  return used;
}
