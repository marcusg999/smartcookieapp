import "server-only";

import { revalidateTag } from "next/cache";
import type { z } from "zod";

import { fail, type ActionResult } from "@/lib/auth/action-result";
import { audit } from "@/lib/auth/audit";
import { authorizeAction, type AuthUser } from "@/lib/auth/guards";
import type { AppRole } from "@/lib/auth/roles";
import { rateLimit } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";

export const OWNER: AppRole[] = ["owner"];
export const OPS: AppRole[] = ["ops", "owner"];
export const STAFF: AppRole[] = ["kitchen", "ops", "owner"];

type Ctx = { user: AuthUser; supabase: Awaited<ReturnType<typeof createClient>> };

/**
 * The shape of every admin Server Action (CLAUDE.md §4):
 * (1) authenticate, (2) authorize by role at AAL2 (+ step-up when asked),
 * (3) validate with Zod, (4) RLS is the final gate (the user's own client),
 * (5) audit. Database errors are mapped to friendly messages.
 */
export async function adminAction<S extends z.ZodType, T = undefined>(
  opts: { roles: AppRole[]; stepUp?: boolean; action: string; schema: S; input: unknown; revalidate?: string[] },
  fn: (
    data: z.infer<S>,
    ctx: Ctx,
  ) => Promise<ActionResult<T> | { auditEntity?: { type: string; id: string }; result?: ActionResult<T> } | void>,
): Promise<ActionResult<T>> {
  const auth = await authorizeAction({
    roles: opts.roles,
    aal2: true,
    recentReauthSeconds: opts.stepUp ? 300 : undefined,
  });
  if (auth.error) return auth.error;
  if (!(await rateLimit("adminMutation", auth.user.id)).success) {
    return fail("rate_limited", "Lots of changes in a short time. Please wait a minute and try again.");
  }
  const parsed = opts.schema.safeParse(opts.input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path.join(".") || "form")] ??= issue.message;
    return fail("validation", "Please check the highlighted fields.", fieldErrors);
  }
  const supabase = await createClient();
  try {
    const out = await fn(parsed.data, { user: auth.user, supabase });
    let result: ActionResult<T> = { ok: true };
    let entity: { type: string; id: string } | undefined;
    if (out && "ok" in out) result = out;
    else if (out) {
      result = out.result ?? { ok: true };
      entity = out.auditEntity;
    }
    if (result.ok) {
      await audit(opts.action, { entityType: entity?.type, entityId: entity?.id });
      for (const tag of opts.revalidate ?? []) revalidateTag(tag, { expire: 0 });
    }
    return result;
  } catch (error) {
    return fail(...dbErrorToFriendly(error));
  }
}

/** Turn a Postgres/PostgREST error into something the owner can act on. */
export function dbErrorToFriendly(
  error: unknown,
): ["validation" | "step_up_required" | "forbidden" | "unknown", string] {
  const e = error as { code?: string; message?: string };
  if (e?.code === "42501" && /price|fresh MFA/i.test(e.message ?? "")) {
    return ["step_up_required", "Please confirm it's you with your authenticator code."];
  }
  if (e?.code === "42501") return ["forbidden", "You don't have permission to do that."];
  if (e?.code === "23505") return ["validation", "Something with that name or link already exists."];
  if (e?.code === "23503")
    return ["validation", "This is still used elsewhere, so it can't be removed. Archive it instead."];
  if (e?.code === "23514" || e?.code === "22023" || e?.code === "P0001")
    return ["validation", e.message ?? "That value isn't allowed."];
  console.error("admin action failed", { code: e?.code });
  return ["unknown", "Something went wrong. Your change wasn't saved."];
}

/**
 * Throw PostgREST errors so adminAction maps them. For selects/inserts with
 * `.single()` the row is guaranteed when there's no error; for updates and
 * deletes the return value is simply unused.
 */
export function check<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  return res.data as NonNullable<T>;
}
