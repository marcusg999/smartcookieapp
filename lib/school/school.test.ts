import { describe, expect, it } from "vitest";

import { bulkOrderSchema, dayChangeSchema, standingOrderSchema } from "@/lib/validation/school";

import { daysOverdue, invoiceState, previousMonth } from "./billing";
import { currentWeek, isWeekOpen, pickWeek } from "./weeks";

const week = (id: string, week_start: string, cutoff: string, status = "published") => ({
  id,
  week_start,
  delivery_dates: [0, 1, 2, 3, 4].map((d) =>
    new Date(Date.parse(`${week_start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10),
  ),
  cutoff,
  status,
});

describe("school billing helpers", () => {
  it("bills the previous calendar month, across year and leap-year boundaries", () => {
    expect(previousMonth("2026-12-01")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(previousMonth("2027-01-01")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(previousMonth("2028-03-15")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("shows an open invoice past its due date as overdue", () => {
    expect(invoiceState({ status: "open", due_date: "2026-11-01" }, "2026-11-02")).toBe("overdue");
    expect(invoiceState({ status: "open", due_date: "2026-11-02" }, "2026-11-02")).toBe("open");
    expect(invoiceState({ status: "paid", due_date: "2026-11-01" }, "2026-12-01")).toBe("paid");
  });
  it("counts days overdue (never negative)", () => {
    expect(daysOverdue("2026-11-01", "2026-11-08")).toBe(7);
    expect(daysOverdue("2026-11-10", "2026-11-08")).toBe(0);
    expect(daysOverdue(null, "2026-11-08")).toBe(0);
  });
});

describe("school weeks", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const weeks = [
    week("a", "2026-11-23", "2026-11-20T02:00:00Z"),
    week("b", "2026-11-30", "2026-11-27T02:00:00Z"),
    week("c", "2026-12-07", "2026-12-04T02:00:00Z"),
  ];
  it("is open only when published and before cutoff", () => {
    expect(isWeekOpen(weeks[0]!, now)).toBe(false);
    expect(isWeekOpen(weeks[1]!, now)).toBe(true);
    expect(isWeekOpen({ ...weeks[1]!, status: "closed" }, now)).toBe(false);
  });
  it("defaults to the first week still open, honouring an explicit choice", () => {
    expect(pickWeek(weeks, "", now)?.id).toBe("b");
    expect(pickWeek(weeks, "a", now)?.id).toBe("a");
  });
  it("this week = the week holding today", () => {
    expect(currentWeek(weeks, "2026-11-25")?.id).toBe("a");
    expect(currentWeek(weeks, "2026-11-28")?.id).toBe("b");
  });
});

describe("school inputs (tamper)", () => {
  const so = {
    name: "Room 4 lunch",
    classroom_id: "11111111-1111-4111-8111-111111111111",
    weekdays: [1, 2, 3],
    start_date: "2026-12-01",
    end_date: null,
    status: "active",
    quantity_mode: "per_headcount",
    fixed_quantity: null,
    buffer_percent: 10,
    menu_selection_mode: "chefs_choice",
    day_items: {},
    rotation: [],
    notes: "",
  };
  it("accepts a chef's-choice standing order with no day items", () => {
    expect(standingOrderSchema.safeParse(so).success).toBe(true);
  });
  it("strips smuggled fields (price, organization) from a standing order", () => {
    const parsed = standingOrderSchema.parse({ ...so, organization_id: "x", unit_price_cents: 1, total_cents: 1 });
    expect(parsed).not.toHaveProperty("organization_id");
    expect(parsed).not.toHaveProperty("total_cents");
  });
  it("rejects a buffer over 50%, an end before the start, and fixed mode without a count", () => {
    expect(standingOrderSchema.safeParse({ ...so, buffer_percent: 80 }).success).toBe(false);
    expect(standingOrderSchema.safeParse({ ...so, end_date: "2026-11-01" }).success).toBe(false);
    expect(standingOrderSchema.safeParse({ ...so, quantity_mode: "fixed" }).success).toBe(false);
  });
  it("requires items for specific-item standing orders, and only weekday keys", () => {
    expect(standingOrderSchema.safeParse({ ...so, menu_selection_mode: "specific_items" }).success).toBe(false);
    expect(
      standingOrderSchema.safeParse({
        ...so,
        menu_selection_mode: "specific_items",
        day_items: { "1": [so.classroom_id] },
      }).success,
    ).toBe(true);
    expect(standingOrderSchema.safeParse({ ...so, day_items: { "9": [] } }).success).toBe(false);
  });
  it("bulk orders carry no prices and cap quantities", () => {
    const bulk = {
      menu_week_id: so.classroom_id,
      location: "Library",
      notes: "",
      items: [
        {
          menu_item_id: so.classroom_id,
          delivery_date: "2026-12-01",
          quantity: 600,
          classroom_id: null,
          unit_price_cents: 1,
        },
      ],
    };
    expect(bulkOrderSchema.safeParse(bulk).success).toBe(false);
    const ok = bulkOrderSchema.parse({ ...bulk, items: [{ ...bulk.items[0]!, quantity: 20 }] });
    expect(ok.items[0]).not.toHaveProperty("unit_price_cents");
  });
  it("a day change can't set a negative headcount", () => {
    const base = {
      standing_order_id: so.classroom_id,
      delivery_date: "2026-12-01",
      skip: false,
      items: null,
      note: "",
      clear: false,
    };
    expect(dayChangeSchema.safeParse({ ...base, headcount: -1 }).success).toBe(false);
    expect(dayChangeSchema.safeParse({ ...base, headcount: 12 }).success).toBe(true);
  });
});
