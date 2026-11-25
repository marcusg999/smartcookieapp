import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { envSchema, publicSchema, serverOnlySchema, validateEnv } from "./env.schema";

function parseDotenv(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

const example = parseDotenv(".env.example");

describe("env schema", () => {
  it("accepts the committed .env.example", () => {
    expect(() => validateEnv(example)).not.toThrow();
  });

  it(".env.example lists every required variable", () => {
    const shape = { ...publicSchema.shape, ...serverOnlySchema.shape };
    const required = Object.entries(shape)
      .filter(([, schema]) => !schema.safeParse(undefined).success)
      .map(([key]) => key);
    for (const key of required) expect(example, `missing ${key}`).toHaveProperty(key);
  });

  it("fails and names the missing variable without printing values", () => {
    const { STRIPE_SECRET_KEY, ...rest } = example;
    expect(STRIPE_SECRET_KEY).toBeDefined();
    let message = "";
    try {
      validateEnv(rest);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("STRIPE_SECRET_KEY");
    expect(message).not.toContain(example.RESEND_API_KEY);
  });

  it("rejects malformed keys", () => {
    const result = envSchema.safeParse({ ...example, STRIPE_WEBHOOK_SECRET: "not-a-secret" });
    expect(result.success).toBe(false);
  });

  const production = {
    ...example,
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://smartcookie.example",
    STRIPE_SECRET_KEY: "sk_live_x",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAAreal",
    TURNSTILE_SECRET_KEY: "0x4AAAAAAAreal-secret",
    UPSTASH_REDIS_REST_URL: "https://real-db.upstash.io",
    MAILPIT_URL: undefined,
  };

  it("refuses the staging sign-in limit override in production", () => {
    expect(envSchema.safeParse({ ...production, AUTH_RATE_LIMIT_PER_MINUTE: "200" }).success).toBe(false);
  });

  it("refuses the local Mailpit transport in production", () => {
    expect(envSchema.safeParse({ ...production, MAILPIT_URL: "http://127.0.0.1:54324" }).success).toBe(false);
  });

  it("accepts a production config with live keys", () => {
    expect(envSchema.safeParse(production).success).toBe(true);
  });

  it("rejects test/placeholder values in production", () => {
    for (const override of [
      { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
      { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" },
      { UPSTASH_REDIS_REST_URL: "https://example.upstash.io" },
      { NEXT_PUBLIC_SITE_URL: "http://smartcookie.example" },
      { STEP_UP_MAX_AGE_SECONDS: "5" },
    ]) {
      expect(envSchema.safeParse({ ...production, ...override }).success, JSON.stringify(override)).toBe(false);
    }
  });

  it("requires live Stripe keys in production and test keys elsewhere", () => {
    const prodWithTest = envSchema.safeParse({
      ...production,
      STRIPE_SECRET_KEY: "sk_test_x",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x",
    });
    expect(prodWithTest.success).toBe(false);

    const stagingWithLive = envSchema.safeParse({
      ...example,
      NEXT_PUBLIC_APP_ENV: "staging",
      STRIPE_SECRET_KEY: "sk_live_x",
    });
    expect(stagingWithLive.success).toBe(false);
  });
});
