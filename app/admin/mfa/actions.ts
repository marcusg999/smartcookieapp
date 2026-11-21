"use server";

import { z } from "zod";

import { fail, type ActionResult } from "@/lib/auth/action-result";
import { audit } from "@/lib/auth/audit";
import { getUser } from "@/lib/auth/guards";
import { clearFailures, isLockedOut, recordFailure } from "@/lib/auth/lockout";
import { createClient } from "@/lib/supabase/server";

const LOCKED = "Too many incorrect codes. Please wait 15 minutes and try again.";

/** Start TOTP enrollment: returns the QR code (SVG data URL) and the secret for manual entry. */
export async function startTotpEnrollment(): Promise<
  ActionResult<{ factorId: string; qrCode: string; secret: string }>
> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");
  const supabase = await createClient();

  // Remove abandoned, unverified TOTP factors so enrollment can restart cleanly.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return fail("unknown", "We couldn't start setup. Please try again.");
  return { ok: true, data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

const verifySchema = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  purpose: z.enum(["enroll", "challenge", "step_up"]),
});

/**
 * Verify a TOTP code (enrollment, sign-in challenge, or step-up). Runs on the
 * server so failed attempts count toward the lockout and are audited. On
 * success the session is upgraded to AAL2 and the cookie is refreshed.
 */
export async function verifyTotp(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");

  const parsed = verifySchema.safeParse({
    factorId: formData.get("factorId"),
    code: String(formData.get("code") ?? "").replace(/\s/g, ""),
    purpose: formData.get("purpose"),
  });
  if (!parsed.success) {
    return fail("validation", "Enter the 6-digit code from your authenticator app.", {
      code: "Enter the 6-digit code from your authenticator app.",
    });
  }
  if (await isLockedOut("mfa", user.id)) return fail("locked", LOCKED);

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) {
    await recordFailure("mfa", user.id);
    await audit("auth.mfa_failed", {
      entityType: "user",
      entityId: user.id,
      metadata: { purpose: parsed.data.purpose },
    });
    return fail("unauthorized", "That code didn't work. Check your authenticator app and try again.", {
      code: "That code didn't work.",
    });
  }

  await clearFailures("mfa", user.id);
  await audit(parsed.data.purpose === "enroll" ? "auth.mfa_enrolled" : "auth.mfa_verified", {
    entityType: "user",
    entityId: user.id,
    metadata: { factor: "totp", purpose: parsed.data.purpose },
  });
  return { ok: true };
}

/** One-time backup codes, shown once after enrolling TOTP. Requires AAL2. */
export async function generateRecoveryCodes(): Promise<ActionResult<{ codes: string[] }>> {
  const user = await getUser();
  if (!user || user.aal !== "aal2") return fail("step_up_required", "Verify your authenticator first.");
  const supabase = await createClient();
  const status = await supabase.auth.mfa.recoveryCodes.getStatus();
  const result = status.data
    ? await supabase.auth.mfa.recoveryCodes.regenerate()
    : await supabase.auth.mfa.recoveryCodes.generate({ friendlyName: "Recovery codes" });
  if (result.error?.code === "mfa_recovery_codes_enroll_not_enabled") {
    // Recovery codes are a project setting (hosted dashboard); the local CLI can't enable them.
    return fail(
      "unknown",
      "Backup codes aren't switched on for this project yet. As a backup, add a second authenticator (another phone or a password manager) from your security page.",
    );
  }
  if (result.error || !result.data) {
    return fail("unknown", "We couldn't create backup codes. Try again from your security page.");
  }
  await audit("auth.mfa_recovery_codes_generated", { entityType: "user", entityId: user.id });
  return { ok: true, data: { codes: result.data.codes } };
}

/** Sign-in challenge with a backup code instead of the authenticator app. */
export async function verifyRecoveryCode(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");
  const code = String(formData.get("recoveryCode") ?? "").trim();
  if (code.length < 6 || code.length > 64) return fail("validation", "Enter one of your backup codes.");
  if (await isLockedOut("mfa", user.id)) return fail("locked", LOCKED);

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.recoveryCodes.verify({ code });
  if (error) {
    await recordFailure("mfa", user.id);
    await audit("auth.mfa_failed", { entityType: "user", entityId: user.id, metadata: { purpose: "recovery_code" } });
    return fail("unauthorized", "That backup code didn't work.");
  }
  await clearFailures("mfa", user.id);
  await supabase.auth.refreshSession();
  await audit("auth.mfa_verified", { entityType: "user", entityId: user.id, metadata: { factor: "recovery_code" } });
  return { ok: true };
}

/** Remove a TOTP factor (account security page). Staff can't remove their last factor. */
export async function removeTotpFactor(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");
  if (user.aal !== "aal2") return fail("step_up_required", "Verify your authenticator first.");
  const factorId = z.uuid().safeParse(formData.get("factorId"));
  if (!factorId.success) return fail("validation", "Unknown factor.");

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verifiedTotp = (factors?.totp ?? []).filter((f) => f.status === "verified");
  const isStaffUser = user.roles.some((r) => r === "kitchen" || r === "ops" || r === "owner");
  if (isStaffUser && verifiedTotp.length <= 1) {
    return fail("forbidden", "Staff accounts must keep at least one authenticator app.");
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factorId.data });
  if (error) return fail("unknown", "We couldn't remove that authenticator.");
  await supabase.auth.refreshSession();
  // CLAUDE.md §5.7: an MFA change signs out every other session.
  await supabase.auth.signOut({ scope: "others" });
  await audit("auth.mfa_disabled", { entityType: "user", entityId: user.id, metadata: { factor: "totp" } });
  return { ok: true, message: "Authenticator removed. Other devices have been signed out." };
}
