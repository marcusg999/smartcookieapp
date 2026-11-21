import { z } from "zod";

/**
 * Browser-safe env schema, split out so client bundles never include the
 * server-only schema (lib/env.schema.ts).
 */
const appEnv = z.enum(["development", "staging", "production"]);

const url = z.url();

// Supabase publishable key (`sb_publishable_…`) or a legacy JWT-shaped anon key.
const supabasePublishableKey = z
  .string()
  .regex(/^(sb_publishable_|eyJ)/, "must be a Supabase publishable (or legacy anon) key");

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

export type PublicEnv = z.infer<typeof publicSchema>;
