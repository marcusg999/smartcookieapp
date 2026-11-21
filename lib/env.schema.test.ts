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
    const required = [...Object.keys(publicSchema.shape), ...Object.keys(serverOnlySchema.shape)].filter(
      (key) => !key.startsWith("SENTRY_"),
    );
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

  it("requires live Stripe keys in production and test keys elsewhere", () => {
    const prodWithTest = envSchema.safeParse({ ...example, NEXT_PUBLIC_APP_ENV: "production" });
    expect(prodWithTest.success).toBe(false);

    const prodWithLive = envSchema.safeParse({
      ...example,
      NEXT_PUBLIC_APP_ENV: "production",
      STRIPE_SECRET_KEY: "sk_live_x",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x",
    });
    expect(prodWithLive.success).toBe(true);

    const stagingWithLive = envSchema.safeParse({
      ...example,
      NEXT_PUBLIC_APP_ENV: "staging",
      STRIPE_SECRET_KEY: "sk_live_x",
    });
    expect(stagingWithLive.success).toBe(false);
  });
});
