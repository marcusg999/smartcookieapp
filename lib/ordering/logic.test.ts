import { describe, expect, it } from "vitest";

import {
  blockingAllergens,
  defaultCutoff,
  normalizeLines,
  planRepeat,
  priceCart,
  setLineQuantity,
  timeLeft,
  warningAllergens,
  weeklyShare,
  type SwapMeal,
} from "./logic";

const LA = "America/Los_Angeles";
const meals = {
  pasta: { priceCents: 900, isSnack: false },
  rice: { priceCents: 800, isSnack: false },
  cookie: { priceCents: 300, isSnack: true },
};
const zone = { feeCents: 500, freeOverCents: 5000, minOrderCents: 1000 };

describe("priceCart (mirrors _write_family_order)", () => {
  it("prices à la carte with fee, percent discount and tax", () => {
    const t = priceCart({
      lines: [
        { childId: "a", menuItemId: "pasta", deliveryDate: "2031-01-06", quantity: 2 },
        { childId: "b", menuItemId: "rice", deliveryDate: "2031-01-07", quantity: 1 },
      ],
      meals,
      zone,
      discount: { type: "percent", value: 10 },
      taxBps: 950,
    });
    expect(t.subtotalCents).toBe(2600);
    expect(t.deliveryFeeCents).toBe(500);
    expect(t.discountCents).toBe(260);
    expect(t.taxCents).toBe(222); // 9.5% of 2340, rounded
    expect(t.totalCents).toBe(2600 + 500 + 222 - 260);
  });

  it("waives delivery over the threshold and flags orders under the minimum", () => {
    expect(priceCart({ lines: [{ childId: "a", menuItemId: "pasta", deliveryDate: "d", quantity: 6 }], meals, zone }).deliveryFeeCents).toBe(0);
    expect(priceCart({ lines: [{ childId: "a", menuItemId: "cookie", deliveryDate: "d", quantity: 1 }], meals, zone }).belowMinimum).toBe(true);
  });

  it("caps a fixed discount at the subtotal and never goes negative", () => {
    const t = priceCart({ lines: [{ childId: "a", menuItemId: "cookie", deliveryDate: "d", quantity: 1 }], meals, discount: { type: "fixed", value: 1000 } });
    expect(t.discountCents).toBe(300);
    expect(t.totalCents).toBe(0);
  });

  it("ignores lines for meals not on the menu", () => {
    expect(priceCart({ lines: [{ childId: "a", menuItemId: "gone", deliveryDate: "d", quantity: 3 }], meals }).totalCents).toBe(0);
  });
});

describe("allowance math", () => {
  const plan = { mealsPerInterval: 2, snacksPerInterval: 1, includesSnacks: true, interval: "week" as const, unit: "per_child" as const };

  it("spreads longer intervals across weeks, rounding up", () => {
    expect(weeklyShare(5, "week")).toBe(5);
    expect(weeklyShare(5, "two_weeks")).toBe(3);
    expect(weeklyShare(20, "month")).toBe(5); // 20 × 12 / 52 = 4.6 → 5
  });

  it("includes meals per child and charges extras at the menu price", () => {
    const t = priceCart({
      lines: [
        { childId: "a", menuItemId: "pasta", deliveryDate: "d", quantity: 3 },
        { childId: "b", menuItemId: "rice", deliveryDate: "d", quantity: 2 },
        { childId: "a", menuItemId: "cookie", deliveryDate: "d", quantity: 2 },
      ],
      meals,
      plan,
    });
    expect(t.lines.map((l) => [l.coveredQty, l.paidQty])).toEqual([[2, 1], [2, 0], [1, 1]]);
    expect(t.subtotalCents).toBe(900 + 300);
    expect(t.mealsUsed).toEqual({ a: 2, b: 2 });
  });

  it("shares a household allowance across children and counts other orders", () => {
    const t = priceCart({
      lines: [
        { childId: "a", menuItemId: "pasta", deliveryDate: "d", quantity: 1 },
        { childId: "b", menuItemId: "pasta", deliveryDate: "d", quantity: 1 },
      ],
      meals,
      plan: { ...plan, unit: "per_household", mealsPerInterval: 3 },
      usedElsewhere: { meals: { household: 2 } },
    });
    expect(t.subtotalCents).toBe(900);
    expect(t.mealsUsed.household).toBe(3);
  });

  it("covers nothing in a skipped week, and still qualifies for free delivery on full value", () => {
    expect(priceCart({ lines: [{ childId: "a", menuItemId: "pasta", deliveryDate: "d", quantity: 1 }], meals, plan: { ...plan, skipped: true } }).subtotalCents).toBe(900);
    const t = priceCart({ lines: [{ childId: "a", menuItemId: "pasta", deliveryDate: "d", quantity: 6 }], meals, plan: { ...plan, mealsPerInterval: 6 }, zone });
    expect([t.subtotalCents, t.deliveryFeeCents, t.belowMinimum]).toEqual([0, 0, false]);
  });
});

describe("allergy checks (mirror _blocking_allergens)", () => {
  const meal = { id: "m1", contains: ["Peanuts", "Milk"], mayContain: ["Sesame"] };
  it("blocks contains; blocks may-contain only when severe; warns otherwise", () => {
    expect(blockingAllergens({ allergies: [{ allergen: "peanuts", severity: "allergy" }] }, meal)).toEqual(["peanuts"]);
    expect(blockingAllergens({ allergies: [{ allergen: "Sesame", severity: "allergy" }] }, meal)).toEqual([]);
    expect(warningAllergens({ allergies: [{ allergen: "Sesame", severity: "allergy" }] }, meal)).toEqual(["Sesame"]);
    expect(blockingAllergens({ allergies: [{ allergen: "Sesame", severity: "severe" }] }, meal)).toEqual(["Sesame"]);
  });
  it("respects an owner-approved override", () => {
    expect(blockingAllergens({ allergies: [{ allergen: "Milk", severity: "allergy" }], overrides: ["m1"] }, meal)).toEqual([]);
  });
});

describe("planRepeat (swap suggestion)", () => {
  const menu: SwapMeal[] = [
    { id: "mac", name: "Mac", category: "Mains", isSnack: false, contains: ["Milk", "Wheat"], mayContain: [] },
    { id: "curry", name: "Curry", category: "Mains", isSnack: false, contains: [], mayContain: [] },
    { id: "satay", name: "Satay", category: "Mains", isSnack: false, contains: ["Peanuts"], mayContain: [] },
    { id: "slaw", name: "Slaw", category: "Sides", isSnack: false, contains: [], mayContain: [] },
    { id: "cookie", name: "Cookie", category: "Snacks", isSnack: true, contains: ["Wheat"], mayContain: [] },
  ];
  const peanutKid = (childId: string, m: SwapMeal) => childId === "kid1" && m.contains.includes("Peanuts");

  it("keeps meals still on the menu and maps the weekday", () => {
    const r = planRepeat({
      lastLines: [{ childId: "kid1", menuItemId: "mac", deliveryDate: "2031-01-01", quantity: 1, name: "Mac", category: "Mains", isSnack: false }],
      lastWeekStart: "2030-12-30",
      weekStart: "2031-01-06",
      deliveryDates: ["2031-01-06", "2031-01-08"],
      menu,
      isBlocked: peanutKid,
    });
    expect(r.lines).toEqual([{ childId: "kid1", menuItemId: "mac", deliveryDate: "2031-01-08", quantity: 1 }]);
    expect(r.swaps).toEqual([]);
  });

  it("swaps a missing meal for a same-category one the child can eat, and reports it", () => {
    const r = planRepeat({
      lastLines: [{ childId: "kid1", menuItemId: "gone", deliveryDate: "2030-12-30", quantity: 2, name: "Old stew", category: "Mains", isSnack: false }],
      lastWeekStart: "2030-12-30",
      weekStart: "2031-01-06",
      deliveryDates: ["2031-01-06"],
      menu,
      isBlocked: peanutKid,
    });
    expect(r.lines[0]).toEqual({ childId: "kid1", menuItemId: "curry", deliveryDate: "2031-01-06", quantity: 2 });
    expect(r.swaps).toHaveLength(1);
    expect(r.swaps[0]).toMatchObject({ fromName: "Old stew", toId: "curry" });
  });

  it("never suggests a blocked meal and drops a line with no safe option", () => {
    const r = planRepeat({
      lastLines: [{ childId: "kid1", menuItemId: "gone", deliveryDate: "2030-12-30", quantity: 1, name: "Bar", category: "Snacks", isSnack: true }],
      lastWeekStart: "2030-12-30",
      weekStart: "2031-01-06",
      deliveryDates: ["2031-01-06"],
      menu,
      isBlocked: (_c, m) => m.contains.includes("Wheat"),
    });
    expect(r.lines).toEqual([]);
    expect(r.dropped).toEqual([{ childId: "kid1", fromName: "Bar" }]);
  });
});

describe("cart lines", () => {
  it("sets, clears and merges quantities", () => {
    const base = { childId: "a", menuItemId: "pasta", deliveryDate: "d" };
    let lines = setLineQuantity([], base, 2);
    lines = setLineQuantity(lines, base, 3);
    expect(lines).toEqual([{ ...base, quantity: 3 }]);
    expect(setLineQuantity(lines, base, 0)).toEqual([]);
    expect(normalizeLines([{ ...base, quantity: 1 }, { ...base, quantity: 2 }])).toEqual([{ ...base, quantity: 3 }]);
  });
});

describe("cutoff across DST (America/Los_Angeles)", () => {
  it("Thursday 6pm before a winter week is 02:00 UTC Friday (PST)", () => {
    expect(defaultCutoff("2026-11-30", 4, "18:00", LA)).toBe("2026-11-27T02:00:00.000Z");
  });
  it("in summer it's 01:00 UTC (PDT)", () => {
    expect(defaultCutoff("2026-07-13", 4, "18:00:00", LA)).toBe("2026-07-10T01:00:00.000Z");
  });
  it("a cutoff on the spring-forward Sunday uses PDT after 3am", () => {
    // 2027-03-14 is the US spring-forward date; week of Mon 2027-03-15, 1 day before at 18:00.
    expect(defaultCutoff("2027-03-15", 1, "18:00", LA)).toBe("2027-03-15T01:00:00.000Z");
  });
  it("a cutoff on the fall-back Sunday uses PST in the evening", () => {
    // 2026-11-01 is fall-back; week of Mon 2026-11-02.
    expect(defaultCutoff("2026-11-02", 1, "18:00", LA)).toBe("2026-11-02T02:00:00.000Z");
  });
  it("a week whose cutoff is the Thursday before a DST change keeps the old offset", () => {
    // Week of Mon 2027-03-15, cutoff Thu 2027-03-11 18:00 PST.
    expect(defaultCutoff("2027-03-15", 4, "18:00", LA)).toBe("2027-03-12T02:00:00.000Z");
  });
  it("counts down and closes", () => {
    const now = new Date("2026-11-27T00:30:00Z");
    expect(timeLeft("2026-11-27T02:00:00Z", now)).toMatchObject({ closed: false, days: 0, hours: 1, minutes: 30 });
    expect(timeLeft("2026-11-27T02:00:00Z", new Date("2026-11-27T02:00:01Z")).closed).toBe(true);
  });
});
