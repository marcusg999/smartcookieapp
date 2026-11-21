"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, type ActionResult } from "@/lib/auth/action-result";
import { audit } from "@/lib/auth/audit";
import { authorizeAction } from "@/lib/auth/guards";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const STEP_UP_SECONDS = 300;
const staffRole = z.enum(["kitchen", "ops", "owner"]);

/** Owner + AAL2 + fresh step-up + rate limit, for every staff mutation. */
async function authorizeStaffChange() {
  const auth = await authorizeAction({ roles: ["owner"], recentReauthSeconds: STEP_UP_SECONDS });
  if (auth.error) return auth;
  if (!(await rateLimit("adminMutation", auth.user.id)).success) {
    return { error: fail("rate_limited", "Too many changes in a short time. Please wait a minute.") };
  }
  return auth;
}

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: staffRole });

export async function inviteStaff(input: { email: string; role: string }): Promise<ActionResult> {
  const auth = await authorizeStaffChange();
  if (auth.error) return auth.error;
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail("validation", "Enter a valid email and role.");

  const supabase = await createClient();
  const { data: existingId, error: lookupError } = await supabase.rpc("admin_find_user_id", {
    p_email: parsed.data.email,
  });
  if (lookupError) return fail("forbidden", "Not allowed.");

  let userId = existingId as string | null;
  if (!userId) {
    // Service role: creating an invited auth user is an Auth admin API call
    // with no RLS equivalent. Authorization was checked above (owner, AAL2,
    // fresh step-up) and the role grant below goes through RLS-checked SQL.
    const { data, error } = await createAdminClient().auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo: new URL("/auth/confirm?next=/admin", env.NEXT_PUBLIC_SITE_URL).toString(),
    });
    if (error || !data.user) return fail("unknown", "We couldn't send the invitation. Please try again.");
    userId = data.user.id;
  }

  // grant_role re-checks owner + AAL2 + recent MFA in the database.
  const { error } = await supabase.rpc("grant_role", { p_user: userId, p_role: parsed.data.role, p_org: null });
  if (error) return fail(error.code === "42501" ? "step_up_required" : "unknown", "We couldn't grant that role.");

  await audit("staff.invited", {
    entityType: "user",
    entityId: userId,
    metadata: { role: parsed.data.role, existing: Boolean(existingId) },
  });
  revalidatePath("/admin/staff");
  return { ok: true, message: existingId ? "Role granted to the existing account." : "Invitation sent." };
}

const roleChangeSchema = z.object({ userId: z.uuid(), role: staffRole, grant: z.boolean() });

export async function changeStaffRole(input: { userId: string; role: string; grant: boolean }): Promise<ActionResult> {
  const auth = await authorizeStaffChange();
  if (auth.error) return auth.error;
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return fail("validation", "Invalid request.");

  const supabase = await createClient();
  const { error } = await supabase.rpc(parsed.data.grant ? "grant_role" : "revoke_role", {
    p_user: parsed.data.userId,
    p_role: parsed.data.role,
    p_org: null,
  });
  if (error) {
    if (error.message?.includes("last owner")) return fail("validation", "There must always be at least one owner.");
    return fail(error.code === "42501" ? "step_up_required" : "unknown", "We couldn't change that role.");
  }
  // The role-change row itself is audited by a database trigger.
  revalidatePath("/admin/staff");
  return { ok: true, message: parsed.data.grant ? "Role granted." : "Role removed." };
}

export async function forceSignOut(input: { userId: string }): Promise<ActionResult> {
  const auth = await authorizeStaffChange();
  if (auth.error) return auth.error;
  const userId = z.uuid().safeParse(input.userId);
  if (!userId.success) return fail("validation", "Invalid request.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_revoke_sessions", { p_user: userId.data });
  if (error) return fail(error.code === "42501" ? "step_up_required" : "unknown", "We couldn't sign that user out.");
  revalidatePath("/admin/staff");
  return { ok: true, message: `Signed out of ${data ?? 0} session(s). Access ends within 15 minutes at most.` };
}
