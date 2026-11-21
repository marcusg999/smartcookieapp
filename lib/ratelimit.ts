import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";

/**
 * Named rate limiters (Upstash Redis, sliding window).
 *
 *   auth          5 / minute / IP       sign-in, sign-up, password reset
 *   magicLink     3 / 15 minutes / email
 *   checkout     10 / minute / user
 *   adminMutation 60 / minute / user
 *
 * Usage:
 *   const { success } = await rateLimit("auth", clientIp(await headers()));
 *   if (!success) return { error: "Too many attempts. Please try again shortly." };
 */

export const LIMITS = {
  auth: { tokens: 5, window: "1 m" },
  magicLink: { tokens: 3, window: "15 m" },
  checkout: { tokens: 10, window: "1 m" },
  adminMutation: { tokens: 60, window: "1 m" },
} as const satisfies Record<string, { tokens: number; window: `${number} ${"s" | "m" | "h"}` }>;

export type LimiterName = keyof typeof LIMITS;

let limiters: Record<LimiterName, Ratelimit> | null = null;

function getLimiters(): Record<LimiterName, Ratelimit> {
  if (limiters) return limiters;
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const make = (name: LimiterName) =>
    new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMITS[name].tokens, LIMITS[name].window),
      prefix: `smartcookie:rl:${name}`,
      analytics: false,
      enableTelemetry: false,
    });
  limiters = {
    auth: make("auth"),
    magicLink: make("magicLink"),
    checkout: make("checkout"),
    adminMutation: make("adminMutation"),
  };
  return limiters;
}

/**
 * Identifiers are SHA-256 hashed before they reach Redis, so emails and IP
 * addresses are never stored in plain text by the rate limiter.
 */
export async function hashIdentifier(identifier: string): Promise<string> {
  const data = new TextEncoder().encode(identifier.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function rateLimit(name: LimiterName, identifier: string) {
  const key = await hashIdentifier(identifier);
  const { success, limit, remaining, reset } = await getLimiters()[name].limit(key);
  return { success, limit, remaining, reset };
}

/**
 * Best-effort client IP. On Vercel `x-forwarded-for` is set by the platform
 * (the first entry is the client). Falls back to a constant so a missing
 * header shares one bucket instead of bypassing the limit.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
