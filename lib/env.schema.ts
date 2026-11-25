import { z } from "zod";

/**
 * Environment variable schemas. Pure module (no `server-only`) so it can be
 * imported by `next.config.ts`, which validates the environment at build and
 * dev-server start. Runtime access goes through `lib/env.ts` (server) and
 * `lib/env.public.ts` (browser-safe).
 */

import { publicSchema } from "./env.public-schema";

export { publicSchema };

const url = z.url();

// Supabase issues new-style secret keys (`sb_secret_…`); legacy projects use a
// JWT-shaped service_role key (`eyJ…`). Accept both.
const supabaseSecretKey = z
  .string()
  .regex(/^(sb_secret_|eyJ)/, "must be a Supabase secret (or legacy service_role) key");

/** Server-only secrets. Never import these into client code. */
export const serverOnlySchema = z.object({
  SUPABASE_SECRET_KEY: supabaseSecretKey,
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, "must be a Stripe secret or restricted key"),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_/, "must start with whsec_"),
  RESEND_API_KEY: z.string().regex(/^re_/, "must start with re_"),
  // Optional: the From address for app email, on your verified sending domain
  // (e.g. "hello@mail.smartcookie.com"). Defaults to the contact email in Settings.
  EMAIL_FROM: z.email().optional(),
  // Optional, development / CI only: deliver app email to a local Mailpit
  // (http://127.0.0.1:54324) when no real Resend key is set.
  MAILPIT_URL: url.optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: url,
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  // Optional: bearer secret for scheduled jobs (Vercel Cron → /api/cron/*). Unset = jobs disabled.
  CRON_SECRET: z.string().min(32).optional(),
  // Optional: shorten the 5-minute step-up window (tests only; can never exceed 300).
  STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().min(1).max(300).optional(),
  // Optional, staging only: raise the 5/minute sign-in limit so the regression
  // suite (every test from one CI runner IP) can run. Refused in production.
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(5).max(1000).optional(),
  // Build-time only, optional: lets the Sentry build plugin upload source maps.
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
});

/**
 * Full schema with cross-field rules: production must use live Stripe keys and
 * every other environment must use test keys, so a staging deploy can never
 * charge real cards and production can never silently run in test mode.
 */
// Placeholder/test values that are fine locally but must never reach production.
const TURNSTILE_TEST_KEY = /^[123]x0{18,}(AA|AB|FF)$|^[12]x0+AA$/;

export const envSchema = publicSchema.extend(serverOnlySchema.shape).superRefine((env, ctx) => {
  if (env.NEXT_PUBLIC_APP_ENV === "production") {
    const prodChecks: Array<[keyof typeof env, boolean, string]> = [
      [
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
        TURNSTILE_TEST_KEY.test(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
        "must not be a Turnstile test key in production",
      ],
      [
        "TURNSTILE_SECRET_KEY",
        TURNSTILE_TEST_KEY.test(env.TURNSTILE_SECRET_KEY),
        "must not be a Turnstile test key in production",
      ],
      [
        "UPSTASH_REDIS_REST_URL",
        env.UPSTASH_REDIS_REST_URL.includes("example.upstash.io"),
        "must be a real Upstash database in production",
      ],
      ["NEXT_PUBLIC_SITE_URL", !env.NEXT_PUBLIC_SITE_URL.startsWith("https://"), "must be https in production"],
    ];
    for (const [key, bad, message] of prodChecks) if (bad) ctx.addIssue({ code: "custom", path: [key], message });
    if (env.MAILPIT_URL !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["MAILPIT_URL"],
        message: "is for local development; unset it in production",
      });
    }
    if (env.AUTH_RATE_LIMIT_PER_MINUTE !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_RATE_LIMIT_PER_MINUTE"],
        message: "is for staging test runs only; unset it in production",
      });
    }
    if (env.STEP_UP_MAX_AGE_SECONDS !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["STEP_UP_MAX_AGE_SECONDS"],
        message: "is for tests only; unset it in production",
      });
    }
  }

  const wantLive = env.NEXT_PUBLIC_APP_ENV === "production";
  const mode = wantLive ? "live" : "test";
  const checks: Array<[keyof typeof env, string | undefined]> = [
    ["STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY],
  ];
  for (const [key, value] of checks) {
    if (value && !value.includes(`_${mode}_`)) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `must be a Stripe ${mode} key when NEXT_PUBLIC_APP_ENV=${env.NEXT_PUBLIC_APP_ENV}`,
      });
    }
  }
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type Env = z.infer<typeof envSchema>;

/** Human-readable list of problems, without ever echoing secret values. */
export function formatEnvIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}

/**
 * Validate a raw env object. Throws with a list of missing/invalid variable
 * names (values are never printed). Used by next.config.ts so `next build`
 * and `next dev` fail fast.
 */
export function validateEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid or missing environment variables:\n${formatEnvIssues(result.error)}\n` +
        "See .env.example for the full list.",
    );
  }
  return result.data;
}
