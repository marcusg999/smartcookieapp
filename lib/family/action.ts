import "server-only";

import type { z } from "zod";

import { fail, type ActionResult } from "@/lib/auth/action-result";
import { getUser, type AuthUser } from "@/lib/auth/guards";
import { rateLimit, type LimiterName } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";

type Ctx = {
  user: AuthUser;
  householdId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

/**
 * The shape of every family Server Action (CLAUDE.md §4):
 * (1) authenticate, (2) authorize (a parent with a household), (3) rate
 * limit, (4) validate with Zod, (5) write with the parent's own client so RLS
 * and the database functions are the final gate. Errors become plain words.
 */
export async function familyAction<S extends z.ZodType, R extends ActionResult<unknown> | void>(
  opts: { schema: S; input: unknown; limiter?: LimiterName },
  fn: (data: z.infer<S>, ctx: Ctx) => Promise<R>,
): Promise<Exclude<R, void> | ActionResult<never> | { ok: true }> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");
  if (!user.roles.includes("parent")) return fail("forbidden", "This is for family accounts.");
  if (!(await rateLimit(opts.limiter ?? "familyMutation", user.id)).success) {
    return fail("rate_limited", "That's a lot of changes at once. Please wait a moment and try again.");
  }
  const parsed = opts.schema.safeParse(opts.input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path.join(".") || "form")] ??= issue.message;
    return fail("validation", "Please check the highlighted fields.", fieldErrors);
  }
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!membership) return fail("forbidden", "We couldn't find your household.");
  try {
    const out = await fn(parsed.data, { user, householdId: membership.household_id, supabase });
    return (out ?? { ok: true }) as Exclude<R, void> | { ok: true };
  } catch (error) {
    return fail(...familyErrorToFriendly(error));
  }
}

/** Database errors → words a parent can act on. Raised messages are written for families. */
export function familyErrorToFriendly(error: unknown): ["validation" | "forbidden" | "unknown", string] {
  const e = error as { code?: string; message?: string };
  if (e?.code === "42501") return ["forbidden", "You don't have permission to do that."];
  if (e?.code === "23505") return ["validation", "That's already saved."];
  if (e?.code === "23514" || e?.code === "P0001" || e?.code === "P0002" || e?.code === "22023") {
    return ["validation", (e.message ?? "That isn't allowed.").replace(/^ALLERGY_BLOCK:\s*/, "")];
  }
  console.error("family action failed", { code: e?.code });
  return ["unknown", "Something went wrong. Please try again."];
}

export function check<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  return res.data as NonNullable<T>;
}
