import { z } from "zod";

/**
 * Environment variable schemas. Pure module (no `server-only`) so it can be
 * imported by `next.config.ts`, which validates the environment at build and
 * dev-server start. Runtime access goes through `lib/env.ts` (server) and
 * `lib/env.public.ts` (browser-safe).
 */

const appEnv = z.enum(["development", "staging", "production"]);

const url = z.url();

// Supabase issues new-style keys (`sb_publishable_…` / `sb_secret_…`). Legacy
// projects still use JWT-shaped anon / service_role keys (`eyJ…`). Accept both.
const supabasePublishableKey = z
  .string()
  .regex(/^(sb_publishable_|eyJ)/, "must be a Supabase publishable (or legacy anon) key");
const supabaseSecretKey = z
  .string()
  .regex(/^(sb_secret_|eyJ)/, "must be a Supabase secret (or legacy service_role) key");

/** Variables that are safe to expose to the browser (inlined at build time). */
export const publicSchema = z.object({
  NEXT_PUBLIC_APP_ENV: appEnv,
  NEXT_PUBLIC_SITE_URL: url,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().regex(/^pk_(test|live)_/, "must start with pk_test_ or pk_live_"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: url,
});

/** Server-only secrets. Never import these into client code. */
export const serverOnlySchema = z.object({
  SUPABASE_SECRET_KEY: supabaseSecretKey,
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, "must be a Stripe secret or restricted key"),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_/, "must start with whsec_"),
  RESEND_API_KEY: z.string().regex(/^re_/, "must start with re_"),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: url,
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
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
export const envSchema = publicSchema.extend(serverOnlySchema.shape).superRefine((env, ctx) => {
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
