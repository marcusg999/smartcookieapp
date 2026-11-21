/** Route classification for the proxy's coarse redirects (Phase 2). */

const FAMILY_PROTECTED = ["/account", "/orders", "/cart", "/checkout", "/favorites", "/subscription", "/children"];

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Signed-in-only areas outside /admin. The published /menu stays public. */
export function requiresSignIn(pathname: string): boolean {
  return FAMILY_PROTECTED.some((base) => under(pathname, base)) || under(pathname, "/school");
}

export function isAdminPath(pathname: string): boolean {
  return under(pathname, "/admin");
}

/** MFA enrollment/challenge pages: staff may reach them at AAL1. */
export function isAdminMfaPath(pathname: string): boolean {
  return under(pathname, "/admin/mfa");
}

/** Admin session limits (CLAUDE.md Phase 2 §4). */
export const ADMIN_IDLE_TIMEOUT_SECONDS = 30 * 60;
export const ADMIN_ABSOLUTE_TIMEOUT_SECONDS = 12 * 60 * 60;
export const ADMIN_ACTIVITY_COOKIE = "sc_admin_activity";

/** Short-lived cookie carrying "I'm signing up as a school" through an OAuth round trip. */
export const SIGNUP_INTENT_COOKIE = "sc_signup_intent";
