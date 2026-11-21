/** Roles (CLAUDE.md §2). Mirrors the `public.app_role` enum. */
export const APP_ROLES = ["parent", "school_admin", "school_staff", "kitchen", "ops", "owner"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const STAFF_ROLES = ["kitchen", "ops", "owner"] as const satisfies readonly AppRole[];
export const SCHOOL_ROLES = ["school_admin", "school_staff"] as const satisfies readonly AppRole[];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

export function isStaff(roles: readonly AppRole[]): boolean {
  return roles.some((role) => (STAFF_ROLES as readonly AppRole[]).includes(role));
}

/**
 * Roles from JWT claims (`app_roles`, added by the custom access token hook).
 * Only for coarse routing decisions in the proxy; server guards and RLS
 * re-check `user_roles` in the database.
 */
export function rolesFromClaims(claims: Record<string, unknown> | null | undefined): AppRole[] {
  const raw = claims?.app_roles;
  return Array.isArray(raw) ? raw.filter(isAppRole) : [];
}

type AmrEntry = { method?: string; timestamp?: number };

const MFA_METHODS = new Set(["totp", "mfa/totp", "recovery_code", "webauthn", "mfa/webauthn"]);

function amrEntries(claims: Record<string, unknown> | null | undefined): AmrEntry[] {
  const amr = claims?.amr;
  return Array.isArray(amr) ? (amr as AmrEntry[]) : [];
}

/** Seconds since the most recent MFA verification, or null if none in this session. */
export function secondsSinceMfa(claims: Record<string, unknown> | null | undefined, now = Date.now()): number | null {
  const times = amrEntries(claims)
    .filter((e) => e.method && MFA_METHODS.has(e.method) && typeof e.timestamp === "number")
    .map((e) => e.timestamp as number);
  if (times.length === 0) return null;
  return Math.floor(now / 1000) - Math.max(...times);
}

/** Seconds since the session's first authentication (the oldest amr entry). */
export function secondsSinceSignIn(
  claims: Record<string, unknown> | null | undefined,
  now = Date.now(),
): number | null {
  const times = amrEntries(claims)
    .map((e) => e.timestamp)
    .filter((t): t is number => typeof t === "number");
  if (times.length === 0) return null;
  return Math.floor(now / 1000) - Math.min(...times);
}

/** Seconds since the most recent authentication of any kind (password, OTP, OAuth, MFA). */
export function secondsSinceLastAuth(
  claims: Record<string, unknown> | null | undefined,
  now = Date.now(),
): number | null {
  const times = amrEntries(claims)
    .map((e) => e.timestamp)
    .filter((t): t is number => typeof t === "number");
  if (times.length === 0) return null;
  return Math.floor(now / 1000) - Math.max(...times);
}
