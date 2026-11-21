import { describe, expect, it } from "vitest";

import { addDays, formatDay, formatInZone, fromZonedInput, todayInZone, toZonedInput } from "./time";

const LA = "America/Los_Angeles";

describe("business timezone", () => {
  it("round-trips a winter time (PST, UTC-8)", () => {
    expect(fromZonedInput("2026-11-26T18:00", LA)).toBe("2026-11-27T02:00:00.000Z");
    expect(toZonedInput("2026-11-27T02:00:00.000Z", LA)).toBe("2026-11-26T18:00");
  });
  it("round-trips a summer time (PDT, UTC-7)", () => {
    expect(fromZonedInput("2026-07-09T18:00", LA)).toBe("2026-07-10T01:00:00.000Z");
    expect(toZonedInput("2026-07-10T01:00:00.000Z", LA)).toBe("2026-07-09T18:00");
  });
  it("rejects malformed input", () => {
    expect(fromZonedInput("tomorrow", LA)).toBeNull();
  });
  it("formats and shifts calendar dates without timezone drift", () => {
    expect(formatDay("2026-11-30")).toBe("Mon, Nov 30");
    expect(addDays("2026-11-30", 4)).toBe("2026-12-04");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("formatInZone / todayInZone", () => {
  it("accepts dateStyle without mixing in default fields", () => {
    expect(formatInZone("2026-11-26T02:00:00Z", "America/Los_Angeles", { dateStyle: "medium" })).toBe("Nov 25, 2026");
  });
  it("gives the business-local date", () => {
    expect(todayInZone("America/Los_Angeles", new Date("2026-11-26T05:00:00Z"))).toBe("2026-11-25");
  });
});
