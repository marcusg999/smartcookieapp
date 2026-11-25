import "server-only";

import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; compare in constant time. */
export function cronAuthorized(header: string | null): boolean {
  if (!env.CRON_SECRET || !header) return false;
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
