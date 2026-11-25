import { describe, expect, it } from "vitest";

import {
  allergyBoard,
  cookable,
  cookList,
  cookListCsv,
  cookSentence,
  dietaryRollup,
  kitchenSettings,
  labelData,
  manifest,
  needsAttention,
  packingLists,
  prepFor,
  weekSummary,
  type Line,
  type OpsOrder,
} from "./logic";

let n = 0;
function line(p: Partial<Line> = {}): Line {
  n++;
  return {
    order_item_id: `li-${n}`,
    order_id: p.order_id ?? `o-${n}`,
    order_number: p.order_number ?? `SC-${n}`,
    order_status: "paid",
    order_source: "a_la_carte",
    fulfillment: "delivery",
    delivery_date: "2026-11-30",
    menu_item_id: "turkey",
    item_name: "Turkey wrap",
    quantity: 1,
    allergens_contained: ["Wheat"],
    may_contain: [],
    badges: [],
    safe_for_allergens: [],
    has_allergy_override: false,
    override_reason: null,
    child_id: null,
    child_first_name: null,
    child_last_initial: null,
    child_allergens: [],
    child_dietary: [],
    classroom_id: null,
    classroom_name: null,
    organization_id: null,
    organization_name: null,
    household_id: "h1",
    household_name: "The Patel household",
    zone_name: "Pasadena",
    dropoff_location: null,
    order_notes: null,
    reheat_instructions: null,
    use_by_days: null,
    conflict: null,
    prep_checked_at: null,
    prep_checked_by: null,
    delivered: false,
    ...p,
  };
}

const school = (p: Partial<Line> = {}) =>
  line({
    household_id: null,
    household_name: null,
    organization_id: "org1",
    organization_name: "Maple Grove",
    classroom_id: "room4",
    classroom_name: "Room 4",
    fulfillment: "school_dropoff",
    order_status: "invoiced",
    ...p,
  });

describe("cook list", () => {
  it("splits each item per day into standard and allergy-modified counts", () => {
    const rows = cookList([
      school({ quantity: 38 }),
      school({ quantity: 4, safe_for_allergens: ["Wheat"], item_name: "Turkey wrap" }),
      line({ delivery_date: "2026-12-01", item_name: "Mac & cheese", quantity: 2 }),
    ]);
    expect(rows[0]).toMatchObject({ date: "2026-11-30", item: "Turkey wrap", total: 42, standard: 38, modified: 4 });
    expect(cookSentence(rows[0]!)).toBe("Turkey wrap: 42 total, 38 standard, 4 Wheat-free");
    expect(rows[1]).toMatchObject({ date: "2026-12-01", item: "Mac & cheese", total: 2, standard: 2, modified: 0 });
  });

  it("counts a meal for a severely allergic child as allergy-modified (cross-contact care)", () => {
    const l = line({
      child_id: "c1",
      child_first_name: "Maya",
      allergens_contained: ["Milk"],
      child_allergens: [{ name: "Sesame", severity: "severe" }],
    });
    expect(prepFor(l)).toEqual(["Sesame"]);
    expect(cookList([l])[0]).toMatchObject({
      standard: 0,
      modified: 1,
      modifications: [{ label: "Sesame-free", count: 1 }],
    });
  });

  it("an ordinary allergy that the meal doesn't involve needs no modification", () => {
    const l = line({
      child_id: "c1",
      allergens_contained: ["Milk"],
      child_allergens: [{ name: "Fish", severity: "allergy" }],
    });
    expect(prepFor(l)).toEqual([]);
  });

  it("a may-contain match or an owner override must be prepared safe", () => {
    expect(
      prepFor(
        line({
          child_id: "c1",
          may_contain: ["Wheat"],
          allergens_contained: [],
          child_allergens: [{ name: "Wheat", severity: "allergy" }],
        }),
      ),
    ).toEqual(["Wheat"]);
    expect(
      prepFor(
        line({ child_id: "c1", has_allergy_override: true, child_allergens: [{ name: "Wheat", severity: "allergy" }] }),
      ),
    ).toEqual(["Wheat"]);
  });

  it("leaves out conflicts and (by default) unpaid orders", () => {
    const lines = [line(), line({ order_status: "pending_payment" }), line({ conflict: "Wheat" })];
    expect(cookable(lines, { exclude_unpaid: true })).toHaveLength(1);
    expect(cookable(lines, { exclude_unpaid: false })).toHaveLength(2);
    expect(needsAttention(lines)).toHaveLength(1);
  });

  it("CSV: quotes cells and neutralises spreadsheet formulas", () => {
    const csv = cookListCsv(cookList([line({ item_name: '=HYPERLINK("x")', quantity: 3 })]));
    expect(csv.split("\r\n")[0]).toBe("Delivery date,Item,Total,Standard,Allergy-modified,Modifications");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe("allergy board", () => {
  it("lists children with allergies, severe first within a day, with their meals", () => {
    const board = allergyBoard([
      line({ child_id: "a", child_first_name: "Ava", child_allergens: [{ name: "Wheat", severity: "intolerance" }] }),
      line({
        child_id: "m",
        child_first_name: "Maya",
        child_last_initial: "P",
        child_allergens: [{ name: "Sesame", severity: "severe" }],
      }),
      line({ child_id: "x", child_first_name: "Xi" }),
      school({ safe_for_allergens: ["Peanuts"], quantity: 2 }),
    ]);
    expect(board.map((b) => b.name)).toEqual(["Maya P.", "Ava", "Peanuts-safe meals"]);
    expect(board[0]!.severe).toBe(true);
    expect(board[2]!.place).toBe("Room 4, Maple Grove");
  });
});

describe("labels", () => {
  it("one label per meal, with use-by, contains, prepared-safe-for and severe flags", () => {
    const labels = labelData(
      [
        line({
          child_id: "m",
          child_first_name: "Maya",
          child_last_initial: "P",
          child_allergens: [{ name: "Sesame", severity: "severe" }],
          reheat_instructions: "Serve cold.",
          use_by_days: 2,
        }),
        school({ quantity: 3, item_name: "Veggie pasta" }),
      ],
      kitchenSettings({ use_by_days: 3 }),
    );
    expect(labels).toHaveLength(4);
    const maya = labels.find((l) => l.name === "Maya P.")!;
    expect(maya).toMatchObject({
      place: "The Patel household",
      useBy: "2026-12-02",
      contains: ["Wheat"],
      preparedSafeFor: ["Sesame"],
      severe: true,
      reheat: "Serve cold.",
    });
    const room = labels.filter((l) => l.name === "Room 4");
    expect(room).toHaveLength(3);
    expect(room[0]).toMatchObject({ place: "Maple Grove", useBy: "2026-12-03", severe: false });
  });
});

describe("dietary roll-up and summary", () => {
  it("counts badges per day, preferences per child and allergen totals", () => {
    const r = dietaryRollup([
      line({
        badges: ["Vegetarian"],
        quantity: 2,
        child_id: "a",
        child_dietary: ["vegetarian"],
        child_allergens: [{ name: "Milk", severity: "severe" }],
      }),
      line({
        badges: ["Vegetarian", "Vegan"],
        delivery_date: "2026-12-01",
        child_id: "a",
        child_dietary: ["vegetarian"],
      }),
    ]);
    expect(r.days).toEqual(["2026-11-30", "2026-12-01"]);
    expect(r.badges[0]).toEqual({ name: "Vegetarian", perDay: { "2026-11-30": 2, "2026-12-01": 1 }, total: 3 });
    expect(r.preferences).toEqual([{ name: "vegetarian", children: 1 }]);
    expect(r.allergenMeals).toEqual([{ name: "Wheat", meals: 3 }]);
    expect(r.allergenChildren).toEqual([{ name: "Milk", children: 1, severe: 1 }]);
  });

  it("summary: families vs schools, paid / invoiced / unpaid, capacity used", () => {
    const s = weekSummary(
      [line({ quantity: 2 }), line({ order_status: "pending_payment" }), school({ quantity: 20 })],
      new Map([["turkey", { name: "Turkey wrap", capacity: 30 }]]),
    );
    expect(s).toMatchObject({ meals: 23, families: 3, schools: 20, paid: 2, unpaid: 1, invoiced: 20 });
    expect(s.capacity).toEqual([{ item: "Turkey wrap", used: 23, capacity: 30 }]);
  });
});

describe("packing and manifest", () => {
  it("schools pack per classroom with bag counts; homes per route", () => {
    const { schools, routes } = packingLists(
      [
        school({ quantity: 25 }),
        school({ quantity: 2, safe_for_allergens: ["Peanuts"] }),
        line({ order_number: "SC-9" }),
      ],
      { meals_per_bag: 12 },
    );
    expect(schools[0]!.days[0]!.classrooms[0]).toMatchObject({ name: "Room 4", meals: 27, safe: 2, bags: 3 });
    expect(routes[0]!.zone).toBe("Pasadena");
    expect(routes[0]!.days[0]!.households[0]).toMatchObject({
      name: "The Patel household",
      orderNumber: "SC-9",
      bags: 1,
    });
  });

  it("manifest: home stops by zone then ZIP, one stop per school", () => {
    const home = (id: string, zip: string, zone: string): OpsOrder => ({
      order_id: id,
      order_number: id,
      status: "paid",
      fulfillment: "delivery",
      household_name: `Home ${id}`,
      organization_id: null,
      organization_name: null,
      address: { line1: "1 St", zip },
      zone_name: zone,
      zip,
      phone: "555",
      dropoff: null,
      delivered_dates: [],
    });
    const orders = [home("b", "91105", "Pasadena"), home("a", "91101", "Pasadena"), home("c", "90026", "Echo Park")];
    const lines = [line({ order_id: "a" }), line({ order_id: "b" }), line({ order_id: "c" })];
    const stops = manifest(orders, lines, "2026-11-30", { meals_per_bag: 12 });
    expect(stops.map((s) => s.name)).toEqual(["Home c", "Home a", "Home b"]);
  });
});
