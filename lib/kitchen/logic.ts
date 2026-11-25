/**
 * Phase 8 kitchen logic: pure functions over the week's lines (from the
 * `fulfillment_lines` database function), shared by the screens, the CSV/PDF
 * exports and the tests. No prices or contact details ever pass through here.
 */

export type ChildAllergy = { name: string; severity: "intolerance" | "allergy" | "severe" };

export type Line = {
  order_item_id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  order_source: string;
  fulfillment: "delivery" | "school_dropoff";
  delivery_date: string | null;
  menu_item_id: string | null;
  item_name: string;
  quantity: number;
  allergens_contained: string[];
  may_contain: string[];
  badges: string[];
  safe_for_allergens: string[];
  has_allergy_override: boolean;
  override_reason: string | null;
  child_id: string | null;
  child_first_name: string | null;
  child_last_initial: string | null;
  child_allergens: ChildAllergy[];
  child_dietary: string[];
  classroom_id: string | null;
  classroom_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  household_id: string | null;
  household_name: string | null;
  zone_name: string | null;
  dropoff_location: string | null;
  order_notes: string | null;
  reheat_instructions: string | null;
  use_by_days: number | null;
  conflict: string | null;
  prep_checked_at: string | null;
  prep_checked_by: string | null;
  delivered: boolean;
};

export type KitchenSettings = {
  exclude_unpaid: boolean;
  label_sheet: "avery_5163" | "avery_5164";
  use_by_days: number;
  meals_per_bag: number;
};

export const DEFAULT_KITCHEN_SETTINGS: KitchenSettings = {
  exclude_unpaid: true,
  label_sheet: "avery_5163",
  use_by_days: 3,
  meals_per_bag: 12,
};

export function kitchenSettings(raw: unknown): KitchenSettings {
  const r = (raw ?? {}) as Partial<KitchenSettings>;
  return {
    exclude_unpaid: r.exclude_unpaid ?? true,
    label_sheet: r.label_sheet === "avery_5164" ? "avery_5164" : "avery_5163",
    use_by_days: Math.min(14, Math.max(1, Number(r.use_by_days) || 3)),
    meals_per_bag: Math.min(100, Math.max(1, Number(r.meals_per_bag) || 12)),
  };
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];
export const isUnpaid = (l: Pick<Line, "order_status">) => l.order_status === "pending_payment";
export const isSchool = (l: Pick<Line, "organization_id" | "fulfillment">) =>
  l.organization_id !== null || l.fulfillment === "school_dropoff";

/** "Maya P." / "Room 4 · Sunflowers" / the household name. */
export function whoFor(l: Line): string {
  if (l.child_first_name) return `${l.child_first_name}${l.child_last_initial ? ` ${l.child_last_initial}.` : ""}`;
  return l.classroom_name ?? l.dropoff_location ?? l.household_name ?? "";
}

/** Where it goes: "Room 4 · Sunflowers, Maple Grove Elementary" or the household. */
export function destination(l: Line): string {
  if (l.organization_name) return [l.classroom_name ?? l.dropoff_location, l.organization_name].filter(Boolean).join(", ");
  return l.household_name ?? "";
}

/**
 * Allergens this meal must be PREPARED SAFE FOR (CLAUDE.md §6):
 * school allergy-safe alternates, a child's allergen the meal lists (owner
 * override) or may contain, and every severe allergy (cross-contact care).
 */
export function prepFor(l: Line): string[] {
  const listed = new Set([...l.allergens_contained, ...l.may_contain]);
  return uniq([
    ...l.safe_for_allergens,
    ...l.child_allergens.filter((a) => listed.has(a.name) || a.severity === "severe").map((a) => a.name),
  ]);
}

export const isModified = (l: Line) => prepFor(l).length > 0;
export const hasSevere = (l: Line) => l.child_allergens.some((a) => a.severity === "severe");

/**
 * Lines the kitchen cooks: never conflicts (they're in "Needs attention"),
 * and unpaid à-la-carte orders only when the owner's setting allows.
 */
export function cookable(lines: Line[], settings: Pick<KitchenSettings, "exclude_unpaid">): Line[] {
  return lines.filter((l) => !l.conflict && !(settings.exclude_unpaid && isUnpaid(l)));
}

export type CookRow = {
  date: string;
  item: string;
  total: number;
  standard: number;
  modified: number;
  /** e.g. [{ label: "Wheat-free", count: 3 }] */
  modifications: { label: string; count: number }[];
};

/** Per delivery day: each item × total, split into standard vs allergy-modified. */
export function cookList(lines: Line[]): CookRow[] {
  const rows = new Map<string, CookRow>();
  for (const l of lines) {
    const date = l.delivery_date ?? "";
    const key = `${date}|${l.item_name}`;
    const row = rows.get(key) ?? { date, item: l.item_name, total: 0, standard: 0, modified: 0, modifications: [] };
    row.total += l.quantity;
    const prep = prepFor(l);
    if (prep.length) {
      row.modified += l.quantity;
      const label = `${prep.join(" + ")}-free`;
      const m = row.modifications.find((x) => x.label === label);
      if (m) m.count += l.quantity;
      else row.modifications.push({ label, count: l.quantity });
    } else {
      row.standard += l.quantity;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || b.total - a.total || a.item.localeCompare(b.item));
}

/** "Turkey wrap: 42 total, 38 standard, 4 Wheat-free" */
export function cookSentence(r: CookRow): string {
  const mods = r.modifications.map((m) => `${m.count} ${m.label}`).join(", ");
  return `${r.item}: ${r.total} total, ${r.standard} standard${mods ? `, ${mods}` : ""}`;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Quote, double quotes, and neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function cookListCsv(rows: CookRow[]): string {
  const head = ["Delivery date", "Item", "Total", "Standard", "Allergy-modified", "Modifications"];
  const body = rows.map((r) => [r.date, r.item, r.total, r.standard, r.modified, r.modifications.map((m) => `${m.count} ${m.label}`).join("; ")]);
  return [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type BoardEntry = {
  childKey: string;
  name: string;
  place: string;
  allergens: ChildAllergy[];
  severe: boolean;
  meals: { line: Line; prep: string[] }[];
  firstDate: string;
};

/**
 * Allergy Board: every child with an allergy who has a meal this week (and
 * school allergy-safe meals for unlinked children), soonest first, severe
 * first within a day.
 */
export function allergyBoard(lines: Line[]): BoardEntry[] {
  const map = new Map<string, BoardEntry>();
  for (const l of lines) {
    const flagged = l.child_allergens.length > 0 || l.safe_for_allergens.length > 0;
    if (!flagged) continue;
    const key = l.child_id ?? `room:${l.classroom_id ?? l.order_id}:${l.safe_for_allergens.join("+")}`;
    const entry =
      map.get(key) ??
      ({
        childKey: key,
        name: l.child_id ? whoFor(l) : `${l.safe_for_allergens.join(" + ")}-safe meals`,
        place: destination(l),
        allergens: l.child_id ? l.child_allergens : l.safe_for_allergens.map((name) => ({ name, severity: "allergy" as const })),
        severe: hasSevere(l),
        meals: [],
        firstDate: l.delivery_date ?? "",
      } satisfies BoardEntry);
    entry.meals.push({ line: l, prep: prepFor(l) });
    if ((l.delivery_date ?? "") < entry.firstDate) entry.firstDate = l.delivery_date ?? "";
    map.set(key, entry);
  }
  for (const e of map.values()) e.meals.sort((a, b) => (a.line.delivery_date ?? "").localeCompare(b.line.delivery_date ?? ""));
  return [...map.values()].sort(
    (a, b) => a.firstDate.localeCompare(b.firstDate) || Number(b.severe) - Number(a.severe) || a.name.localeCompare(b.name),
  );
}

/** "Needs attention": lines that clash with a child's allergies right now. */
export const needsAttention = (lines: Line[]) => lines.filter((l) => l.conflict);

export type Rollup = {
  days: string[];
  badges: { name: string; perDay: Record<string, number>; total: number }[];
  preferences: { name: string; children: number }[];
  allergenMeals: { name: string; meals: number }[];
  allergenChildren: { name: string; children: number; severe: number }[];
};

/** Dietary roll-up: badge counts per day, children's preferences, allergen totals for the week. */
export function dietaryRollup(lines: Line[]): Rollup {
  const days = uniq(lines.map((l) => l.delivery_date ?? "")).sort();
  const badges = new Map<string, Record<string, number>>();
  const allergenMeals = new Map<string, number>();
  const prefChildren = new Map<string, Set<string>>();
  const allergenChildren = new Map<string, { kids: Set<string>; severe: Set<string> }>();
  for (const l of lines) {
    const d = l.delivery_date ?? "";
    for (const b of l.badges) {
      const row = badges.get(b) ?? {};
      row[d] = (row[d] ?? 0) + l.quantity;
      badges.set(b, row);
    }
    for (const a of l.allergens_contained) allergenMeals.set(a, (allergenMeals.get(a) ?? 0) + l.quantity);
    if (l.child_id) {
      for (const p of l.child_dietary) prefChildren.set(p, (prefChildren.get(p) ?? new Set()).add(l.child_id));
      for (const a of l.child_allergens) {
        const e = allergenChildren.get(a.name) ?? { kids: new Set(), severe: new Set() };
        e.kids.add(l.child_id);
        if (a.severity === "severe") e.severe.add(l.child_id);
        allergenChildren.set(a.name, e);
      }
    }
  }
  return {
    days,
    badges: [...badges.entries()]
      .map(([name, perDay]) => ({ name, perDay, total: Object.values(perDay).reduce((s, n) => s + n, 0) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    preferences: [...prefChildren.entries()].map(([name, s]) => ({ name, children: s.size })).sort((a, b) => b.children - a.children),
    allergenMeals: [...allergenMeals.entries()].map(([name, meals]) => ({ name, meals })).sort((a, b) => b.meals - a.meals),
    allergenChildren: [...allergenChildren.entries()]
      .map(([name, e]) => ({ name, children: e.kids.size, severe: e.severe.size }))
      .sort((a, b) => b.children - a.children),
  };
}

export type Summary = {
  meals: number;
  byDay: { date: string; meals: number }[];
  families: number;
  schools: number;
  paid: number;
  invoiced: number;
  unpaid: number;
  childrenWithAllergies: number;
  capacity: { item: string; used: number; capacity: number | null }[];
};

/** Summary tiles for This Week. `capacities` maps menu item id → { name, capacity }. */
export function weekSummary(lines: Line[], capacities: Map<string, { name: string; capacity: number | null }>): Summary {
  const byDay = new Map<string, number>();
  let families = 0;
  let schools = 0;
  let paid = 0;
  let invoiced = 0;
  let unpaid = 0;
  const used = new Map<string, number>();
  for (const l of lines) {
    byDay.set(l.delivery_date ?? "", (byDay.get(l.delivery_date ?? "") ?? 0) + l.quantity);
    if (isSchool(l) && l.household_id === null) schools += l.quantity;
    else families += l.quantity;
    if (isUnpaid(l)) unpaid += l.quantity;
    else if (l.order_status === "invoiced") invoiced += l.quantity;
    else paid += l.quantity;
    if (l.menu_item_id) used.set(l.menu_item_id, (used.get(l.menu_item_id) ?? 0) + l.quantity);
  }
  return {
    meals: [...byDay.values()].reduce((s, n) => s + n, 0),
    byDay: [...byDay.entries()].map(([date, meals]) => ({ date, meals })).sort((a, b) => a.date.localeCompare(b.date)),
    families,
    schools,
    paid,
    invoiced,
    unpaid,
    childrenWithAllergies: new Set(lines.filter((l) => l.child_id && l.child_allergens.length).map((l) => l.child_id)).size,
    capacity: [...capacities.entries()]
      .map(([id, c]) => ({ item: c.name, used: used.get(id) ?? 0, capacity: c.capacity }))
      .filter((c) => c.used > 0 || c.capacity !== null)
      .sort((a, b) => b.used - a.used),
  };
}

export type Label = {
  name: string;
  place: string;
  meal: string;
  deliveryDate: string;
  useBy: string;
  contains: string[];
  mayContain: string[];
  preparedSafeFor: string[];
  severe: boolean;
  reheat: string | null;
};

const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * One label per meal. Named lines (a child) get the child's name; unnamed
 * school meals get the classroom. Use-by = delivery + the item's days (or
 * the owner's default).
 */
export function labelData(lines: Line[], settings: Pick<KitchenSettings, "use_by_days">): Label[] {
  const out: Label[] = [];
  const sorted = [...lines].sort(
    (a, b) =>
      (a.delivery_date ?? "").localeCompare(b.delivery_date ?? "") ||
      destination(a).localeCompare(destination(b)) ||
      whoFor(a).localeCompare(whoFor(b)),
  );
  for (const l of sorted) {
    const date = l.delivery_date ?? "";
    const label: Label = {
      name: whoFor(l),
      place: l.child_first_name ? destination(l) : (l.organization_name ?? l.household_name ?? ""),
      meal: l.item_name,
      deliveryDate: date,
      useBy: date ? addDays(date, l.use_by_days ?? settings.use_by_days) : "",
      contains: l.allergens_contained,
      mayContain: l.may_contain,
      preparedSafeFor: prepFor(l),
      severe: hasSevere(l),
      reheat: l.reheat_instructions,
    };
    for (let i = 0; i < l.quantity; i++) out.push(label);
  }
  return out;
}

export type PackSchool = {
  name: string;
  days: {
    date: string;
    classrooms: { name: string; meals: number; safe: number; bags: number; named: string[] }[];
  }[];
};
export type PackRoute = {
  zone: string;
  days: { date: string; households: { name: string; orderNumber: string; bags: number; items: string[] }[] }[];
};

/** Packing lists: school → day → classroom (bag counts); delivery route → day → household. */
export function packingLists(lines: Line[], settings: Pick<KitchenSettings, "meals_per_bag">) {
  const schools = new Map<string, Map<string, Map<string, { meals: number; safe: number; named: Set<string> }>>>();
  const routes = new Map<string, Map<string, Map<string, { orderNumber: string; items: string[] }>>>();
  for (const l of lines) {
    const date = l.delivery_date ?? "";
    if (l.organization_name) {
      const byDay = schools.get(l.organization_name) ?? new Map();
      const rooms = byDay.get(date) ?? new Map();
      const room = l.classroom_name ?? l.dropoff_location ?? "Other";
      const r = rooms.get(room) ?? { meals: 0, safe: 0, named: new Set<string>() };
      r.meals += l.quantity;
      if (isModified(l)) r.safe += l.quantity;
      if (l.child_first_name) r.named.add(whoFor(l));
      rooms.set(room, r);
      byDay.set(date, rooms);
      schools.set(l.organization_name, byDay);
    } else {
      const zone = l.zone_name ?? "No zone";
      const byDay = routes.get(zone) ?? new Map();
      const homes = byDay.get(date) ?? new Map();
      const key = `${l.household_name ?? ""}|${l.order_number}`;
      const h = homes.get(key) ?? { orderNumber: l.order_number, items: [] };
      h.items.push(`${whoFor(l)}: ${l.item_name}${l.quantity > 1 ? ` ×${l.quantity}` : ""}`);
      homes.set(key, h);
      byDay.set(date, homes);
      routes.set(zone, byDay);
    }
  }
  const schoolList: PackSchool[] = [...schools.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, byDay]) => ({
      name,
      days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rooms]) => ({
          date,
          classrooms: [...rooms.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([room, r]) => ({
              name: room,
              meals: r.meals,
              safe: r.safe,
              bags: Math.ceil(r.meals / settings.meals_per_bag),
              named: [...r.named].sort(),
            })),
        })),
    }));
  const routeList: PackRoute[] = [...routes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([zone, byDay]) => ({
      zone,
      days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, homes]) => ({
          date,
          households: [...homes.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, h]) => ({ name: key.split("|")[0]!, orderNumber: h.orderNumber, bags: 1, items: h.items })),
        })),
    }));
  return { schools: schoolList, routes: routeList };
}

export type OpsOrder = {
  order_id: string;
  order_number: string;
  status: string;
  fulfillment: "delivery" | "school_dropoff";
  household_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  address: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; delivery_notes?: string } | null;
  zone_name: string | null;
  zip: string | null;
  phone: string | null;
  dropoff: { entrance?: string; contact?: string; window?: string; instructions?: string } | null;
  delivered_dates: string[];
};

export type Stop = {
  key: string;
  kind: "home" | "school";
  zone: string;
  name: string;
  address: string;
  zip: string;
  notes: string;
  phone: string;
  bags: number;
  orderIds: string[];
  orderNumbers: string[];
  delivered: boolean;
};

/**
 * Delivery manifest for one day: home deliveries grouped by zone and ordered
 * by ZIP, plus one stop per school. Bags: one per family order; schools by
 * meals per bag. Families choosing school drop-off ride with that school.
 */
export function manifest(orders: OpsOrder[], lines: Line[], date: string, settings: Pick<KitchenSettings, "meals_per_bag">): Stop[] {
  const dayLines = lines.filter((l) => l.delivery_date === date);
  const mealsByOrder = new Map<string, number>();
  const schoolOf = new Map<string, string>();
  for (const l of dayLines) {
    mealsByOrder.set(l.order_id, (mealsByOrder.get(l.order_id) ?? 0) + l.quantity);
    if (l.organization_id) schoolOf.set(l.order_id, l.organization_id);
  }
  const stops = new Map<string, Stop>();
  for (const o of orders) {
    const meals = mealsByOrder.get(o.order_id);
    if (!meals) continue;
    const orgId = o.organization_id ?? schoolOf.get(o.order_id) ?? null;
    const a = o.address ?? {};
    if (orgId) {
      const school = orders.find((x) => x.organization_id === orgId);
      const key = `school:${orgId}`;
      const s =
        stops.get(key) ??
        ({
          key,
          kind: "school",
          zone: "Schools",
          name: o.organization_name ?? school?.organization_name ?? dayLines.find((l) => l.organization_id === orgId)?.organization_name ?? "School",
          address: [a.line1, a.city, a.zip].filter(Boolean).join(", "),
          zip: o.zip ?? "",
          notes: [o.dropoff?.entrance, o.dropoff?.window, o.dropoff?.contact, o.dropoff?.instructions].filter(Boolean).join(" · "),
          phone: o.phone ?? "",
          bags: 0,
          orderIds: [],
          orderNumbers: [],
          delivered: true,
        } satisfies Stop);
      if (!s.address && a.line1) s.address = [a.line1, a.city, a.zip].filter(Boolean).join(", ");
      if (!s.zip && o.zip) s.zip = o.zip;
      if (!s.phone && o.phone) s.phone = o.phone;
      s.orderIds.push(o.order_id);
      s.orderNumbers.push(o.order_number);
      s.bags += Math.ceil(meals / settings.meals_per_bag);
      s.delivered &&= o.delivered_dates.includes(date);
      stops.set(key, s);
    } else if (o.fulfillment === "delivery") {
      stops.set(`home:${o.order_id}`, {
        key: `home:${o.order_id}`,
        kind: "home",
        zone: o.zone_name ?? "No zone",
        name: o.household_name ?? o.order_number,
        address: [a.line1, a.line2, a.city, a.zip].filter(Boolean).join(", "),
        zip: o.zip ?? a.zip ?? "",
        notes: a.delivery_notes ?? "",
        phone: o.phone ?? "",
        bags: 1,
        orderIds: [o.order_id],
        orderNumbers: [o.order_number],
        delivered: o.delivered_dates.includes(date),
      });
    }
  }
  return [...stops.values()].sort(
    (a, b) =>
      Number(a.kind === "school") - Number(b.kind === "school") ||
      a.zone.localeCompare(b.zone) ||
      a.zip.localeCompare(b.zip) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Ingredient roll-up hook (Phase 8 nice-to-have). Menu items carry free-text
 * ingredients today; once items have structured ingredients (quantity per
 * portion), sum them here per day.
 */
export function ingredientRollup(): null {
  return null;
}
