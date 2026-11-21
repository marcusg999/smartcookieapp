import { describe, expect, it, vi } from "vitest";

import { passwordStrength } from "./password";
import { safeNext } from "./redirect";
import { isStaff, rolesFromClaims, secondsSinceLastAuth, secondsSinceMfa, secondsSinceSignIn } from "./roles";
import { requiresSignIn, isAdminMfaPath, isAdminPath } from "./routes";

describe("safeNext (open-redirect protection)", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/orders?week=2#top")).toBe("/orders?week=2#top");
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "orders",
    "/x\r\nSet-Cookie: a=b",
  ])("rejects %s", (value) => {
    expect(safeNext(value, "/account")).toBe("/account");
  });
  it("falls back when missing", () => {
    expect(safeNext(null)).toBe("/account");
  });
});

describe("rolesFromClaims", () => {
  it("reads only known roles from app_roles", () => {
    expect(rolesFromClaims({ app_roles: ["parent", "owner", "superuser", 7] })).toEqual(["parent", "owner"]);
  });
  it("ignores user_metadata entirely", () => {
    expect(rolesFromClaims({ user_metadata: { app_roles: ["owner"] } })).toEqual([]);
  });
  it("detects staff", () => {
    expect(isStaff(["parent"])).toBe(false);
    expect(isStaff(["parent", "kitchen"])).toBe(true);
  });
});

describe("amr timing", () => {
  const now = 1_800_000_000_000;
  const s = now / 1000;
  const claims = {
    amr: [
      { method: "totp", timestamp: s - 120 },
      { method: "password", timestamp: s - 4000 },
    ],
  };
  it("measures time since MFA, sign-in and last auth", () => {
    expect(secondsSinceMfa(claims, now)).toBe(120);
    expect(secondsSinceSignIn(claims, now)).toBe(4000);
    expect(secondsSinceLastAuth(claims, now)).toBe(120);
  });
  it("returns null without MFA", () => {
    expect(secondsSinceMfa({ amr: [{ method: "password", timestamp: s }] }, now)).toBeNull();
    expect(secondsSinceMfa({}, now)).toBeNull();
  });
});

describe("route classification", () => {
  it("protects family and school areas but keeps the menu public", () => {
    expect(requiresSignIn("/account/security")).toBe(true);
    expect(requiresSignIn("/school/invoices")).toBe(true);
    expect(requiresSignIn("/menu")).toBe(false);
    expect(requiresSignIn("/accounting")).toBe(false);
  });
  it("identifies admin and MFA paths", () => {
    expect(isAdminPath("/admin/staff")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminMfaPath("/admin/mfa/enroll")).toBe(true);
  });
});

describe("passwordStrength", () => {
  it("caps short passwords as weak", () => {
    expect(passwordStrength("Ab1!xyz").score).toBeLessThanOrEqual(1);
  });
  it("penalises common words and sequences", () => {
    expect(passwordStrength("password123456").score).toBeLessThanOrEqual(1);
  });
  it("rates long mixed passphrases highly", () => {
    expect(passwordStrength("Tomato-Basil-Lunchbox-42").score).toBeGreaterThanOrEqual(3);
  });
});

describe("isPwnedPassword", () => {
  it("matches the hash suffix from the range API (k-anonymity)", async () => {
    const { isPwnedPassword } = await import("./pwned");
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
      return new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0000000000000000000000000000000000:0");
    });
    expect(await isPwnedPassword("password", fetchMock as unknown as typeof fetch)).toBe(true);
    expect(await isPwnedPassword("a-unique-passphrase-no-one-uses", fetchMock as unknown as typeof fetch)).toBe(false);
  });
  it("fails open when the API is unreachable", async () => {
    const { isPwnedPassword } = await import("./pwned");
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await isPwnedPassword("password", failing as unknown as typeof fetch)).toBe(false);
  });
});
