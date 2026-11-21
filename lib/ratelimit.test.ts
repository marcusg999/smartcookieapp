import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" },
}));

const { LIMITS, clientIp, hashIdentifier } = await import("./ratelimit");

describe("rate limit configuration", () => {
  it("defines the named limiters (spec four + Phase 5 family and code checks)", () => {
    expect(LIMITS).toEqual({
      auth: { tokens: 5, window: "1 m" },
      magicLink: { tokens: 3, window: "15 m" },
      checkout: { tokens: 10, window: "1 m" },
      adminMutation: { tokens: 60, window: "1 m" },
      familyMutation: { tokens: 90, window: "1 m" },
      codeCheck: { tokens: 8, window: "1 m" },
    });
  });
});

describe("hashIdentifier", () => {
  it("hashes identifiers so emails never reach Redis in plain text", async () => {
    const hash = await hashIdentifier("Parent@Example.com ");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashIdentifier("parent@example.com"));
    expect(hash).not.toContain("example");
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
  });
  it("falls back to x-real-ip, then a shared bucket", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
