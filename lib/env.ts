import "server-only";

import { envSchema, formatEnvIssues, type Env } from "./env.schema";

/**
 * Server-side environment, validated with Zod. Importing this module from a
 * Client Component fails the build (`server-only`), so secrets can't leak into
 * the browser bundle. For browser-safe values use `lib/env.public.ts`.
 */
function load(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid or missing environment variables:\n${formatEnvIssues(result.error)}`);
  }
  return result.data;
}

export const env: Env = load();
