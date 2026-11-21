import "server-only";

import { env } from "@/lib/env";

import { TURNSTILE_DUMMY_TOKEN, TURNSTILE_TEST_SECRET_KEYS } from "./turnstile-keys";

/**
 * Server-side Turnstile verification (CLAUDE.md §5.7). Call before every
 * sign-up, sign-in, magic-link and password-reset request.
 */
export async function verifyTurnstile(token: FormDataEntryValue | null, ip?: string): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;

  // Local/CI with Cloudflare's test secret: no network call (env schema forbids this in production).
  if (TURNSTILE_TEST_SECRET_KEYS.has(env.TURNSTILE_SECRET_KEY) && env.NEXT_PUBLIC_APP_ENV !== "production") {
    return env.TURNSTILE_SECRET_KEY.startsWith("1x") && token === TURNSTILE_DUMMY_TOKEN;
  }

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
