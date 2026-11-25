import "server-only";

import { createHash } from "node:crypto";

import { headers } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { cache } from "react";

import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { fail, GENERIC, type ActionResult } from "./action-result";
import { deviceLabel } from "./device";
import { safeNext } from "./redirect";
import { isAppRole, isStaff, secondsSinceMfa, type AppRole } from "./roles";

export type AuthUser = {
  id: string;
  email: string | null;
  aal: "aal1" | "aal2";
  /** Roles read from the database (not the JWT), via RLS-scoped query. */
  roles: AppRole[];
  organizationIds: string[];
  claims: Record<string, unknown>;
};

/**
 * The verified current user, or null. `getClaims()` validates the JWT
 * signature; roles are re-read from `user_roles` so a stale token can't keep
 * revoked privileges (CLAUDE.md §5.3). Cached per request.
 */
export const getUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || !claims || typeof claims.sub !== "string") return null;

  const { data: rows } = await supabase.from("user_roles").select("role, organization_id").eq("user_id", claims.sub);
  const roles = (rows ?? []).map((r) => r.role).filter(isAppRole);
  const organizationIds = [
    ...new Set((rows ?? []).map((r) => r.organization_id).filter((v): v is string => Boolean(v))),
  ];

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    roles: [...new Set(roles)],
    organizationIds,
    claims,
  };
});

/** For pages: redirect signed-out users to sign-in. */
export async function requireUser(next?: string): Promise<AuthUser> {
  const user = await getUser();
  if (!user) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return user;
}

/**
 * For pages: require one of `roles`. By default a miss is a 404, so admin and
 * school areas don't reveal that they exist.
 */
export async function requireRole(roles: readonly AppRole[], options: { next?: string } = {}): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    if (options.next) redirect(`/sign-in?next=${encodeURIComponent(options.next)}`);
    notFound();
  }
  if (!user.roles.some((role) => roles.includes(role))) notFound();
  return user;
}

/**
 * For admin pages: staff role + AAL2. Non-staff get a 404 (the admin area
 * doesn't reveal itself); staff whose role can't use this page get a 403;
 * staff below AAL2 go to the MFA flow.
 */
export async function requireStaffAAL2(roles: readonly AppRole[] = ["kitchen", "ops", "owner"]): Promise<AuthUser> {
  const user = await requireRole(["kitchen", "ops", "owner"]);
  const verified = await requireAAL2(user);
  if (!verified.roles.some((role) => roles.includes(role))) forbidden();
  return verified;
}

export async function requireAAL2(existing?: AuthUser): Promise<AuthUser> {
  const user = existing ?? (await requireUser());
  if (user.aal !== "aal2") {
    const supabase = await createClient();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    redirect(data?.nextLevel === "aal2" ? "/admin/mfa/challenge" : "/admin/mfa/enroll");
  }
  return user;
}

/** True if the user completed an MFA challenge within `maxAgeSeconds` (step-up, CLAUDE.md §5.5). */
export function hasRecentReauth(user: AuthUser, maxAgeSeconds = 300): boolean {
  const age = secondsSinceMfa(user.claims);
  const window = Math.min(maxAgeSeconds, env.STEP_UP_MAX_AGE_SECONDS ?? maxAgeSeconds);
  return age !== null && age <= window;
}

/**
 * Step-up check for sensitive actions (CLAUDE.md §5.5): null if the user
 * verified MFA within `maxAgeSeconds`, else a `step_up_required` result that
 * makes the client open the MFA modal and retry.
 */
export function requireRecentReauth(user: AuthUser, maxAgeSeconds = 300): ActionResult<never> | null {
  return hasRecentReauth(user, maxAgeSeconds) ? null : fail("step_up_required", GENERIC.stepUp);
}

/**
 * For Server Actions. Returns the user, or an ActionResult error the client
 * can act on (e.g. `step_up_required` opens the MFA modal, then retries).
 * Every admin action calls this first; RLS remains the final gate.
 */
export async function authorizeAction(options: {
  roles?: readonly AppRole[];
  aal2?: boolean;
  recentReauthSeconds?: number;
}): Promise<{ user: AuthUser; error?: undefined } | { user?: undefined; error: ActionResult<never> }> {
  const user = await getUser();
  if (!user) return { error: fail("unauthorized", "Please sign in again.") };
  if (options.roles && !user.roles.some((r) => options.roles!.includes(r))) {
    return { error: fail("forbidden", GENERIC.forbidden) };
  }
  const needsAal2 = options.aal2 ?? (options.roles ? isStaff(options.roles as AppRole[]) : false);
  if ((needsAal2 || options.recentReauthSeconds) && user.aal !== "aal2") {
    return { error: fail("step_up_required", GENERIC.stepUp) };
  }
  if (options.recentReauthSeconds) {
    const stepUp = requireRecentReauth(user, options.recentReauthSeconds);
    if (stepUp) return { error: stepUp };
  }
  return { user };
}

/** Where to send someone right after they sign in. */
export function homeFor(roles: readonly AppRole[]): string {
  if (isStaff(roles)) return "/admin";
  if (roles.includes("school_admin") || roles.includes("school_staff")) return "/school";
  return "/account";
}

/**
 * The URL to send a user to right after any sign-in. Staff below AAL2 go
 * straight to MFA (enroll or challenge), because a redirect rendered inside a
 * Server Action doesn't pass through the proxy. `next` is honoured only if it
 * is a safe relative path the user may open.
 */
/**
 * Owner accounts get a security email when they sign in from a device they
 * haven't used before (Phase 9). Never blocks sign-in.
 */
async function noteOwnerDevice(userId: string) {
  try {
    const label = deviceLabel((await headers()).get("user-agent"));
    const hash = createHash("sha256").update(`${userId}:${label}`).digest("hex");
    // Service role: known_devices has no user policies; record_sign_in_device
    // is granted to the service role only and queues the alert.
    await createAdminClient().rpc("record_sign_in_device", {
      p_user: userId,
      p_device_hash: hash,
      p_device_label: label,
    });
  } catch (error) {
    console.error("recording the sign-in device failed", { message: (error as Error).message });
  }
}

export async function postSignInDestination(next: string | null | undefined): Promise<string> {
  const user = await getUser();
  if (!user) return "/sign-in";
  if (user.roles.includes("owner")) await noteOwnerDevice(user.id);
  if (isStaff(user.roles) && user.aal !== "aal2") {
    const supabase = await createClient();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.nextLevel === "aal2" ? "/admin/mfa/challenge" : "/admin/mfa/enroll";
  }
  const target = safeNext(next, "");
  if (!target || (target.startsWith("/admin") && !isStaff(user.roles))) return homeFor(user.roles);
  return target;
}
