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
 *   familyMutation 90 / minute / user  cart edits, children, favourites
 *   schoolMutation 60 / minute / user  school portal changes
 *   codeCheck      8 / minute / user or IP  discount and pilot codes (no guessing)
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
  familyMutation: { tokens: 90, window: "1 m" },
  schoolMutation: { tokens: 60, window: "1 m" },
  codeCheck: { tokens: 8, window: "1 m" },
} as const satisfies Record<string, { tokens: number; window: `${number} ${"s" | "m" | "h"}` }>;

export type LimiterName = keyof typeof LIMITS;

type Limiter = { limit(key: string): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> };

let limiters: Record<LimiterName, Limiter> | null = null;

const WINDOW_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/**
 * In-memory sliding-window limiter for local dev and CI only (single process,
 * resets on restart). Used when Upstash still has the placeholder URL from
 * .env.example; the env schema forbids that in production.
 */
function memoryLimiter(tokens: number, window: string): Limiter {
  const [amount, unit] = window.split(" ") as [string, string];
  const windowMs = Number(amount) * (WINDOW_MS[unit] ?? 60_000);
  const hits = new Map<string, number[]>();
  return {
    async limit(key) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      const success = recent.length < tokens;
      if (success) recent.push(now);
      hits.set(key, recent);
      return {
        success,
        limit: tokens,
        remaining: Math.max(0, tokens - recent.length),
        reset: (recent[0] ?? now) + windowMs,
      };
    },
  };
}

export function usesPlaceholderRedis(url: string): boolean {
  try {
    return new URL(url).hostname === "example.upstash.io";
  } catch {
    return false;
  }
}

/** The configured limit (staging may raise the sign-in limit for test runs; never production). */
function tokensFor(name: LimiterName): number {
  if (name === "auth" && env.AUTH_RATE_LIMIT_PER_MINUTE && env.NEXT_PUBLIC_APP_ENV !== "production")
    return env.AUTH_RATE_LIMIT_PER_MINUTE;
  return LIMITS[name].tokens;
}

function getLimiters(): Record<LimiterName, Limiter> {
  if (limiters) return limiters;
  if (usesPlaceholderRedis(env.UPSTASH_REDIS_REST_URL) && env.NEXT_PUBLIC_APP_ENV !== "production") {
    limiters = Object.fromEntries(
      (Object.keys(LIMITS) as LimiterName[]).map((name) => [name, memoryLimiter(tokensFor(name), LIMITS[name].window)]),
    ) as Record<LimiterName, Limiter>;
    return limiters;
  }
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const make = (name: LimiterName) =>
    new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(tokensFor(name), LIMITS[name].window),
      prefix: `smartcookie:rl:${name}`,
      analytics: false,
      enableTelemetry: false,
    });
  limiters = Object.fromEntries(
    (Object.keys(LIMITS) as LimiterName[]).map((name) => [name, make(name)]),
  ) as unknown as Record<LimiterName, Limiter>;
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
