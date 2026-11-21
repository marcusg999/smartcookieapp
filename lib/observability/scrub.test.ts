import { describe, expect, it } from "vitest";

import { FILTERED, scrubBreadcrumb, scrubEvent, scrubValue } from "./scrub";

describe("scrubValue", () => {
  it("redacts personal fields and whole child/allergy subtrees", () => {
    const out = scrubValue({
      orderId: "ord_1",
      email: "parent@example.com",
      full_name: "Jane Parent",
      children: [{ first_name: "Sam", allergies: ["peanuts"] }],
      allergies: ["sesame"],
      dietaryPreferences: "vegetarian",
      meta: { phone: "555-0100", count: 3 },
    });
    expect(out).toEqual({
      orderId: "ord_1",
      email: FILTERED,
      full_name: FILTERED,
      children: FILTERED,
      allergies: FILTERED,
      dietaryPreferences: FILTERED,
      meta: { phone: FILTERED, count: 3 },
    });
  });

  it("redacts credentials and emails embedded in strings", () => {
    expect(scrubValue({ password: "hunter2hunter2", authToken: "x" })).toEqual({
      password: FILTERED,
      authToken: FILTERED,
    });
    expect(scrubValue("failed for jane.doe+kids@example.co.uk today")).toBe(`failed for ${FILTERED} today`);
  });

  it("survives circular references", () => {
    const a: Record<string, unknown> = { id: 1 };
    a.self = a;
    expect(scrubValue(a)).toEqual({ id: 1, self: "[Circular]" });
  });
});

describe("scrubEvent", () => {
  it("keeps only the user id and strips cookies, IP headers and bodies", () => {
    const event = scrubEvent({
      message: "Order failed for parent@example.com",
      user: { id: "u_1", email: "parent@example.com", ip_address: "1.2.3.4", username: "jane" },
      request: {
        url: "https://app.test/orders?email=parent@example.com",
        cookies: { "sb-access-token": "x" },
        headers: { "user-agent": "UA", cookie: "a=b", authorization: "Bearer x", "x-forwarded-for": "1.2.3.4" },
        data: { children: [{ first_name: "Sam" }], note: "hi" },
      },
      contexts: { os: { name: "iOS" }, order: { child: { name: "Sam" } } },
      extra: { allergies: ["milk"] },
      exception: { values: [{ type: "Error", value: "No meal for parent@example.com" }] },
      breadcrumbs: [{ message: "clicked as parent@example.com", data: { email: "parent@example.com" } }],
    });

    expect(event.user).toEqual({ id: "u_1" });
    expect(event.message).toBe(`Order failed for ${FILTERED}`);
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({ "user-agent": "UA" });
    expect(event.request?.url).not.toContain("parent@example.com");
    expect(event.request?.data).toEqual({ children: FILTERED, note: FILTERED });
    expect(event.contexts).toEqual({ os: { name: "iOS" }, order: { child: FILTERED } });
    expect(event.extra).toEqual({ allergies: FILTERED });
    expect(event.exception?.values?.[0]?.value).toBe(`No meal for ${FILTERED}`);
    expect(event.breadcrumbs?.[0]).toEqual({ message: `clicked as ${FILTERED}`, data: { email: FILTERED } });
  });

  it("drops a user object without an id", () => {
    expect(scrubEvent({ user: { email: "a@b.co" } }).user).toBeUndefined();
  });

  it("scrubs standalone breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "ui", data: { first_name: "Sam" } })).toEqual({
      category: "ui",
      data: { first_name: FILTERED },
    });
  });
});

describe("scrubSpan", () => {
  it("scrubs span attributes, including dotted keys", async () => {
    const { scrubSpan } = await import("./scrub");
    expect(
      scrubSpan({
        description: "GET /orders?email=a@b.co",
        data: { "user.email": "a@b.co", "http.method": "GET" },
      }),
    ).toEqual({ description: `GET /orders?email=${FILTERED}`, data: { "user.email": FILTERED, "http.method": "GET" } });
  });
});
