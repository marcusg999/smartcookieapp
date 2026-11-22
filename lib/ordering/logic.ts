/**
 * Pure ordering logic shared by the ordering screen (live totals, allowance
 * meter, allergy chips, repeat-last-week) and unit tests. The DATABASE is the
 * source of truth: `_write_family_order` recomputes every number at placement
 * (CLAUDE.md §5.8). These functions mirror it so what a parent sees while
 * picking matches what they're charged; they never decide what's charged.
 */
import { addDays, fromZonedInput } from "@/lib/time";

export type CartLine = { childId: string; menuItemId: string; deliveryDate: string; quantity: number };

export type BillingInterval = "week" | "two_weeks" | "month";
export type AllowanceUnit = "per_child" | "per_household";
export type Severity = "intolerance" | "allergy" | "severe";

export type PlanAllowance = {
  mealsPerInterval: number;
  snacksPerInterval: number;
  includesSnacks: boolean;
  interval: BillingInterval;
  unit: AllowanceUnit;
  skipped?: boolean;
};

export type MealPrice = { priceCents: number; isSnack: boolean };

export type ZoneFees = { feeCents: number; freeOverCents: number | null; minOrderCents: number };

// ─── Allowance ───────────────────────────────────────────────────────────────

/** Meals (or snacks) a plan includes in one menu week. Mirrors public.plan_weekly_share. */
export function weeklyShare(count: number, interval: BillingInterval): number {
  if (interval === "week") return count;
  if (interval === "two_weeks") return Math.ceil(count / 2);
  return Math.ceil((count * 12) / 52);
}

const unitKey = (plan: PlanAllowance, childId: string) => (plan.unit === "per_child" ? childId : "household");

// ─── Pricing ─────────────────────────────────────────────────────────────────

export type PricedLine = CartLine & { unitPriceCents: number; coveredQty: number; paidQty: number };

export type CartTotals = {
  lines: PricedLine[];
  grossCents: number;
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  /** Included meals used / allowed, keyed by child id (or "household"). */
  mealsUsed: Record<string, number>;
  snacksUsed: Record<string, number>;
  mealShare: number;
  snackShare: number;
  belowMinimum: boolean;
};

export function priceCart(input: {
  lines: CartLine[];
  meals: Record<string, MealPrice>;
  plan?: PlanAllowance | null;
  /** Allowance already used this week by the household's other orders. */
  usedElsewhere?: { meals?: Record<string, number>; snacks?: Record<string, number> };
  zone?: ZoneFees | null;
  discount?: { type: "percent" | "fixed"; value: number } | null;
  taxBps?: number;
}): CartTotals {
  const plan = input.plan ?? null;
  const mealShare = plan && !plan.skipped ? weeklyShare(plan.mealsPerInterval, plan.interval) : 0;
  const snackShare =
    plan && !plan.skipped && plan.includesSnacks ? weeklyShare(plan.snacksPerInterval, plan.interval) : 0;
  const mealsUsed: Record<string, number> = { ...(input.usedElsewhere?.meals ?? {}) };
  const snacksUsed: Record<string, number> = { ...(input.usedElsewhere?.snacks ?? {}) };

  let gross = 0;
  let subtotal = 0;
  let anyCovered = false;
  const lines: PricedLine[] = [];
  for (const line of input.lines) {
    const meal = input.meals[line.menuItemId];
    if (!meal) continue;
    const qty = Math.max(0, Math.floor(line.quantity));
    gross += meal.priceCents * qty;
    let covered = 0;
    if (plan) {
      const key = unitKey(plan, line.childId);
      const used = meal.isSnack ? snacksUsed : mealsUsed;
      const share = meal.isSnack ? snackShare : mealShare;
      covered = Math.min(Math.max(share - (used[key] ?? 0), 0), qty);
      used[key] = (used[key] ?? 0) + covered;
    }
    if (covered > 0) anyCovered = true;
    subtotal += meal.priceCents * (qty - covered);
    lines.push({
      ...line,
      quantity: qty,
      unitPriceCents: meal.priceCents,
      coveredQty: covered,
      paidQty: qty - covered,
    });
  }

  const zone = input.zone ?? null;
  const belowMinimum = Boolean(zone && !anyCovered && gross < zone.minOrderCents);
  const fee = zone ? (zone.freeOverCents !== null && gross >= zone.freeOverCents ? 0 : zone.feeCents) : 0;
  const d = input.discount;
  const discount = d
    ? d.type === "percent"
      ? Math.floor((subtotal * d.value) / 100)
      : Math.min(d.value, subtotal)
    : 0;
  const tax = input.taxBps ? Math.round(((subtotal - discount) * input.taxBps) / 10000) : 0;

  return {
    lines,
    grossCents: gross,
    subtotalCents: subtotal,
    deliveryFeeCents: fee,
    discountCents: discount,
    taxCents: tax,
    totalCents: subtotal + fee + tax - discount,
    mealsUsed,
    snacksUsed,
    mealShare,
    snackShare,
    belowMinimum,
  };
}

// ─── Allergies (mirror of public._blocking_allergens) ────────────────────────

export type ChildAllergy = { allergen: string; severity: Severity };
export type MealAllergens = { contains: string[]; mayContain: string[] };

/**
 * Allergens that block this child from this meal: anything the meal contains,
 * plus "may contain" for a severe allergy. An owner override clears it.
 */
export function blockingAllergens(
  child: { allergies: ChildAllergy[]; overrides?: string[] },
  meal: MealAllergens & { id: string },
): string[] {
  if (child.overrides?.includes(meal.id)) return [];
  const contains = new Set(meal.contains.map((a) => a.toLowerCase()));
  const may = new Set(meal.mayContain.map((a) => a.toLowerCase()));
  return child.allergies
    .filter(
      (a) => contains.has(a.allergen.toLowerCase()) || (a.severity === "severe" && may.has(a.allergen.toLowerCase())),
    )
    .map((a) => a.allergen);
}

/** "May contain" matches that only warn (not severe). */
export function warningAllergens(child: { allergies: ChildAllergy[] }, meal: MealAllergens): string[] {
  const may = new Set(meal.mayContain.map((a) => a.toLowerCase()));
  return child.allergies
    .filter((a) => a.severity !== "severe" && may.has(a.allergen.toLowerCase()))
    .map((a) => a.allergen);
}

// ─── Repeat last week ────────────────────────────────────────────────────────

export type SwapMeal = MealAllergens & { id: string; category: string | null; isSnack: boolean; name: string };

export type RepeatResult = {
  lines: CartLine[];
  /** Lines whose meal wasn't on this week's menu and got a similar one. */
  swaps: { childId: string; deliveryDate: string; fromName: string; fromId: string; toId: string }[];
  /** Lines we couldn't fill safely (no compatible meal this week). */
  dropped: { childId: string; fromName: string }[];
};

/**
 * Copy last week's picks into this week. Same weekday → this week's matching
 * delivery day (or the nearest one). A meal that isn't on this week's menu is
 * swapped for a suggestion from the same category whose allergens don't block
 * the child, preferring one with the fewest allergens; swaps are returned so
 * the UI can highlight them for review.
 */
export function planRepeat(input: {
  lastLines: (CartLine & { name: string; category: string | null; isSnack: boolean })[];
  lastWeekStart: string;
  weekStart: string;
  deliveryDates: string[];
  menu: SwapMeal[];
  isBlocked: (childId: string, meal: SwapMeal) => boolean;
}): RepeatResult {
  const byId = new Map(input.menu.map((m) => [m.id, m]));
  const dates = [...input.deliveryDates].sort();
  const result: RepeatResult = { lines: [], swaps: [], dropped: [] };
  if (dates.length === 0) return result;

  const mapDate = (last: string) => {
    const offset = Math.round((Date.parse(last) - Date.parse(input.lastWeekStart)) / 86_400_000);
    const target = addDays(input.weekStart, offset);
    if (dates.includes(target)) return target;
    // Nearest delivery day to the same weekday.
    return dates.reduce((best, d) =>
      Math.abs(Date.parse(d) - Date.parse(target)) < Math.abs(Date.parse(best) - Date.parse(target)) ? d : best,
    );
  };

  const usedForChildDay = new Map<string, Set<string>>();
  for (const last of input.lastLines) {
    const deliveryDate = mapDate(last.deliveryDate);
    const dayKey = `${last.childId}|${deliveryDate}`;
    const used = usedForChildDay.get(dayKey) ?? new Set<string>();
    usedForChildDay.set(dayKey, used);

    const same = byId.get(last.menuItemId);
    if (same && !input.isBlocked(last.childId, same)) {
      result.lines.push({ childId: last.childId, menuItemId: same.id, deliveryDate, quantity: last.quantity });
      used.add(same.id);
      continue;
    }
    const candidates = input.menu
      .filter((m) => m.isSnack === last.isSnack && !input.isBlocked(last.childId, m))
      .sort((a, b) => {
        const cat = Number(b.category === last.category) - Number(a.category === last.category);
        if (cat) return cat;
        const fresh = Number(used.has(a.id)) - Number(used.has(b.id));
        if (fresh) return fresh;
        return a.contains.length + a.mayContain.length - (b.contains.length + b.mayContain.length);
      });
    const pick = candidates[0];
    if (!pick) {
      result.dropped.push({ childId: last.childId, fromName: last.name });
      continue;
    }
    used.add(pick.id);
    result.lines.push({ childId: last.childId, menuItemId: pick.id, deliveryDate, quantity: last.quantity });
    result.swaps.push({
      childId: last.childId,
      deliveryDate,
      fromName: last.name,
      fromId: last.menuItemId,
      toId: pick.id,
    });
  }
  return result;
}

// ─── Cart line helpers ───────────────────────────────────────────────────────

export const lineKey = (l: Pick<CartLine, "childId" | "menuItemId" | "deliveryDate">) =>
  `${l.childId}|${l.menuItemId}|${l.deliveryDate}`;

/** Add or remove units of a meal for a child on a day; zero removes the line. */
export function setLineQuantity(lines: CartLine[], target: Omit<CartLine, "quantity">, quantity: number): CartLine[] {
  const key = lineKey(target);
  const rest = lines.filter((l) => lineKey(l) !== key);
  const q = Math.max(0, Math.min(20, Math.floor(quantity)));
  return q === 0 ? rest : [...rest, { ...target, quantity: q }];
}

/** Merge duplicate lines (same child, meal, day). */
export function normalizeLines(lines: CartLine[]): CartLine[] {
  const map = new Map<string, CartLine>();
  for (const l of lines) {
    const key = lineKey(l);
    const prev = map.get(key);
    map.set(key, { ...l, quantity: Math.min(20, (prev?.quantity ?? 0) + l.quantity) });
  }
  return [...map.values()].filter((l) => l.quantity > 0);
}

// ─── Cutoff ──────────────────────────────────────────────────────────────────

/**
 * The default cutoff for a week (Monday `weekStart`): `daysBefore` days
 * earlier at local `time` in the business timezone. Mirrors
 * public.menu_week_cutoff, DST-correct.
 */
export function defaultCutoff(weekStart: string, daysBefore: number, time: string, timeZone: string): string {
  const day = addDays(weekStart, -daysBefore);
  const hhmm = time.slice(0, 5);
  const iso = fromZonedInput(`${day}T${hhmm}`, timeZone);
  if (!iso) throw new Error(`bad cutoff time: ${time}`);
  return iso;
}

export type TimeLeft = { closed: boolean; days: number; hours: number; minutes: number; totalMs: number };

export function timeLeft(cutoffIso: string, now: Date = new Date()): TimeLeft {
  const ms = Date.parse(cutoffIso) - now.getTime();
  if (ms <= 0) return { closed: true, days: 0, hours: 0, minutes: 0, totalMs: 0 };
  const minutes = Math.floor(ms / 60_000);
  return {
    closed: false,
    days: Math.floor(minutes / 1440),
    hours: Math.floor((minutes % 1440) / 60),
    minutes: minutes % 60,
    totalMs: ms,
  };
}
