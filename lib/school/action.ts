import "server-only";

import type { z } from "zod";

import { fail, type ActionResult } from "@/lib/auth/action-result";
import { getUser, type AuthUser } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";

export type SchoolRole = "school_admin" | "school_staff";

type Ctx = {
  user: AuthUser;
  orgId: string;
  role: SchoolRole;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

/**
 * The shape of every school portal Server Action (CLAUDE.md §4):
 * (1) authenticate, (2) authorize (a school role in the user's organization;
 * admin-only actions say so), (3) rate limit, (4) validate with Zod, (5) write
 * with the user's own client so RLS and the database functions (which
 * re-check the organization and the week's cutoff) are the final gate.
 */
export async function schoolAction<S extends z.ZodType, R extends ActionResult<unknown> | void>(
  opts: { schema: S; input: unknown; adminOnly?: boolean },
  fn: (data: z.infer<S>, ctx: Ctx) => Promise<R>,
): Promise<Exclude<R, void> | ActionResult<never> | { ok: true }> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");
  const supabase = await createClient();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role, organization_id")
    .eq("user_id", user.id)
    .in("role", ["school_admin", "school_staff"]);
  const membership =
    (roles ?? []).find((r) => r.role === "school_admin") ?? (roles ?? []).find((r) => r.role === "school_staff");
  if (!membership?.organization_id) return fail("forbidden", "This is for school accounts.");
  const role = membership.role as SchoolRole;
  if (opts.adminOnly && role !== "school_admin") return fail("forbidden", "Only your school's admin can do that.");
  if (!(await rateLimit("schoolMutation", user.id)).success) {
    return fail("rate_limited", "That's a lot of changes at once. Please wait a moment and try again.");
  }
  const parsed = opts.schema.safeParse(opts.input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path.join(".") || "form")] ??= issue.message;
    return fail("validation", "Please check the highlighted fields.", fieldErrors);
  }
  try {
    const out = await fn(parsed.data, { user, orgId: membership.organization_id, role, supabase });
    return (out ?? { ok: true }) as Exclude<R, void> | { ok: true };
  } catch (error) {
    return fail(...schoolErrorToFriendly(error));
  }
}

/** Database errors → plain words. Raised messages are written for schools. */
export function schoolErrorToFriendly(error: unknown): ["validation" | "forbidden" | "unknown", string] {
  const e = error as { code?: string; message?: string };
  if (e?.code === "42501")
    return [
      "forbidden",
      e.message && !/permission denied|row-level/i.test(e.message)
        ? e.message
        : "You don't have permission to do that.",
    ];
  if (e?.code === "23505") return ["validation", "That's already saved."];
  if (e?.code === "23514" || e?.code === "P0001" || e?.code === "22023" || e?.code === "22P02") {
    return ["validation", e.message ?? "That isn't allowed."];
  }
  console.error("school action failed", { code: e?.code });
  return ["unknown", "Something went wrong. Please try again."];
}

export function check<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  return res.data as NonNullable<T>;
}
