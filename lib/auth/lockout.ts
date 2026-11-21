import "server-only";

import { hashIdentifier } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Lockout after repeated failures (CLAUDE.md Phase 2 §8): 5 failed password or
 * MFA attempts for the same account within 15 minutes locks that method for
 * 15 minutes. Keys are hashed, so no emails are stored.
 *
 * Service role is required: auth_attempts has no policies (nobody but the
 * server may read or write it) and failed attempts have no user session.
 */
export const LOCKOUT = { maxFailures: 5, windowMinutes: 15 } as const;

type Kind = "password" | "mfa";

async function keyFor(identifier: string) {
  return hashIdentifier(identifier);
}

export async function isLockedOut(kind: Kind, identifier: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCKOUT.windowMinutes * 60_000).toISOString();
  const { count, error } = await createAdminClient()
    .from("auth_attempts")
    .select("*", { count: "exact", head: true })
    .eq("key", await keyFor(identifier))
    .eq("kind", kind)
    .gte("attempted_at", since);
  if (error) return false;
  return (count ?? 0) >= LOCKOUT.maxFailures;
}

export async function recordFailure(kind: Kind, identifier: string): Promise<void> {
  await createAdminClient()
    .from("auth_attempts")
    .insert({ key: await keyFor(identifier), kind });
}

export async function clearFailures(kind: Kind, identifier: string): Promise<void> {
  await createAdminClient()
    .from("auth_attempts")
    .delete()
    .eq("key", await keyFor(identifier))
    .eq("kind", kind);
}
