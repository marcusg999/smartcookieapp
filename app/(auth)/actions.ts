"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, GENERIC, type ActionResult } from "@/lib/auth/action-result";
import { audit } from "@/lib/auth/audit";
import { getUser, postSignInDestination } from "@/lib/auth/guards";
import { clearFailures, isLockedOut, recordFailure } from "@/lib/auth/lockout";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { isPwnedPassword } from "@/lib/auth/pwned";
import { safeNext } from "@/lib/auth/redirect";
import { requestMeta } from "@/lib/auth/request-meta";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { getPublicSettings } from "@/lib/content/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { hashIdentifier, rateLimit } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";

import { SIGNUP_INTENT_COOKIE } from "@/lib/auth/routes";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH);

function siteUrl(path: string): string {
  return new URL(path, env.NEXT_PUBLIC_SITE_URL).toString();
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Turnstile + per-IP rate limit, shared by every auth form. */
async function preflight(formData: FormData): Promise<ActionResult<never> | null> {
  const { ip } = await requestMeta();
  const limited = await rateLimit("auth", ip);
  if (!limited.success) return fail("rate_limited", GENERIC.rateLimited);
  if (!(await verifyTurnstile(formData.get("cf-turnstile-response"), ip))) return fail("captcha", GENERIC.captcha);
  return null;
}

// ─── Email + password ──────────────────────────────────────────────────────
const signInSchema = z.object({ email, password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });

export async function signInWithPassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const blocked = await preflight(formData);
  if (blocked) return blocked;

  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return fail("validation", GENERIC.signIn);
  const { email: userEmail, password: userPassword } = parsed.data;
  const emailHash = await hashIdentifier(userEmail);

  if (await isLockedOut("password", userEmail)) {
    await audit("auth.sign_in_locked", { anonymous: true, metadata: { email_hash: emailHash } });
    return fail("locked", GENERIC.locked);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: userEmail, password: userPassword });
  if (error || !data.user) {
    await recordFailure("password", userEmail);
    await audit("auth.sign_in_failed", {
      anonymous: true,
      metadata: { method: "password", email_hash: emailHash, reason: error?.code ?? "unknown" },
    });
    return fail("unauthorized", GENERIC.signIn);
  }

  await clearFailures("password", userEmail);
  await audit("auth.sign_in", { entityType: "user", entityId: data.user.id, metadata: { method: "password" } });
  redirect(await postSignInDestination(formData.get("next")?.toString()));
}

// ─── Magic link ────────────────────────────────────────────────────────────
export async function requestMagicLink(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const blocked = await preflight(formData);
  if (blocked) return blocked;

  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success)
    return fail("validation", "Enter a valid email address.", { email: "Enter a valid email address." });

  // Per-email limit (3 per 15 minutes). Respond generically either way.
  const perEmail = await rateLimit("magicLink", parsed.data);
  if (perEmail.success) {
    const next = safeNext(formData.get("next")?.toString(), "/account");
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        // Sign-in only: unknown emails get no account (and the same response).
        shouldCreateUser: false,
        emailRedirectTo: siteUrl(`/auth/confirm?next=${encodeURIComponent(next)}`),
      },
    });
    await audit("auth.magic_link_requested", {
      anonymous: true,
      metadata: { email_hash: await hashIdentifier(parsed.data), delivered: !error },
    });
  }
  return { ok: true, message: GENERIC.link };
}

// ─── OAuth (Google, Apple) ─────────────────────────────────────────────────
const providerSchema = z.enum(["google", "apple"]);
const intentSchema = z.object({
  accountType: z.enum(["parent", "school"]).default("parent"),
  organizationName: z.string().trim().max(120).optional(),
});

export async function signInWithOAuth(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const provider = providerSchema.safeParse(formData.get("provider"));
  if (!provider.success) return fail("validation", "Unknown sign-in provider.");

  const { ip } = await requestMeta();
  if (!(await rateLimit("auth", ip)).success) return fail("rate_limited", GENERIC.rateLimited);

  // Sign-up as a school via OAuth: remember the intent for the callback.
  const intent = intentSchema.safeParse({
    accountType: formData.get("accountType") ?? undefined,
    organizationName: formData.get("organizationName") ?? undefined,
  });
  if (intent.success && intent.data.accountType === "school") {
    if (!intent.data.organizationName || intent.data.organizationName.length < 2) {
      return fail("validation", "Enter your school's name.", { organizationName: "Enter your school's name." });
    }
    (await cookies()).set(SIGNUP_INTENT_COOKIE, JSON.stringify(intent.data), {
      httpOnly: true,
      secure: env.NEXT_PUBLIC_APP_ENV !== "development",
      sameSite: "lax",
      maxAge: 600,
      path: "/auth",
    });
  }

  const next = safeNext(formData.get("next")?.toString(), "");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.data,
    options: {
      redirectTo: siteUrl(`/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`),
      scopes: provider.data === "apple" ? "name email" : undefined,
    },
  });
  if (error || !data.url) {
    return fail("unknown", `${provider.data === "google" ? "Google" : "Apple"} sign-in isn't available right now.`);
  }
  redirect(data.url);
}

// ─── Sign-up ───────────────────────────────────────────────────────────────
const signUpSchema = z
  .object({
    email,
    password,
    fullName: z.string().trim().max(120).optional(),
    accountType: z.enum(["parent", "school"]),
    organizationName: z.string().trim().max(120).optional(),
    pilotCode: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9-]*$/, "Check your invite code.")
      .optional(),
  })
  .refine((v) => v.accountType !== "school" || (v.organizationName?.length ?? 0) >= 2, {
    path: ["organizationName"],
    message: "Enter your school's name.",
  });

export async function signUp(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const blocked = await preflight(formData);
  if (blocked) return blocked;

  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName") || undefined,
    accountType: formData.get("accountType"),
    organizationName: formData.get("organizationName") || undefined,
    pilotCode: formData.get("pilotCode") || undefined,
  });
  if (!parsed.success) return fail("validation", "Please fix the highlighted fields.", fieldErrors(parsed.error));

  // Pilot mode (Phase 5 §7): an unused invite code is required. The
  // handle_new_user trigger re-checks and redeems it; this is the friendly check.
  const settings = await getPublicSettings().catch(() => null);
  if (settings?.pilot_mode) {
    const code = parsed.data.pilotCode ?? "";
    const { data: valid } = code
      ? // Service role: the code check is server-only (after Turnstile + rate
        // limit) so codes can't be guessed through the API directly.
        await createAdminClient().rpc("pilot_code_is_valid", { p_code: code, p_email: parsed.data.email })
      : { data: false };
    if (!valid) {
      return fail("validation", "That invite code isn't valid.", {
        pilotCode: "That invite code isn't valid or has been used.",
      });
    }
  }

  if (await isPwnedPassword(parsed.data.password)) {
    return fail("validation", "That password appeared in a data breach. Please choose a different one.", {
      password: "This password appeared in a known data breach. Choose another.",
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: siteUrl("/auth/confirm?next=/account"),
      // Read by the handle_new_user trigger. It can only choose parent vs a
      // pending school; it can never grant a staff role.
      data: {
        full_name: parsed.data.fullName,
        account_type: parsed.data.accountType,
        organization_name: parsed.data.accountType === "school" ? parsed.data.organizationName : undefined,
        pilot_code: parsed.data.pilotCode ? parsed.data.pilotCode.toUpperCase() : undefined,
      },
    },
  });

  if (error?.code === "weak_password") {
    return fail("validation", "Please choose a stronger password.", {
      password: "This password is too weak or has appeared in a data breach.",
    });
  }
  await audit("auth.sign_up_requested", {
    anonymous: true,
    metadata: { email_hash: await hashIdentifier(parsed.data.email), account_type: parsed.data.accountType },
  });
  // Same response whether or not the email already had an account (no enumeration).
  return { ok: true, message: "Check your email for a link to confirm your account. It expires in 10 minutes." };
}

// ─── Password reset ────────────────────────────────────────────────────────
export async function requestPasswordReset(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const blocked = await preflight(formData);
  if (blocked) return blocked;
  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success)
    return fail("validation", "Enter a valid email address.", { email: "Enter a valid email address." });

  if ((await rateLimit("magicLink", parsed.data)).success) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: siteUrl("/auth/confirm?next=/reset-password"),
    });
    await audit("auth.password_reset_requested", {
      anonymous: true,
      metadata: { email_hash: await hashIdentifier(parsed.data) },
    });
  }
  return { ok: true, message: GENERIC.link };
}

const newPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match." });

/** Sets a new password for the signed-in user (after a recovery link, or from account security). */
export async function updatePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Your reset link has expired. Please request a new one.");

  const parsed = newPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return fail("validation", "Please fix the highlighted fields.", fieldErrors(parsed.error));
  if (await isPwnedPassword(parsed.data.password)) {
    return fail("validation", "That password appeared in a data breach.", {
      password: "This password appeared in a known data breach. Choose another.",
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const message =
      error.code === "reauthentication_needed"
        ? "For your security, sign in again (or use a fresh reset link) before changing your password."
        : error.code === "same_password"
          ? "Choose a password you haven't used here before."
          : "We couldn't update your password. Please try again.";
    return fail("validation", message, { password: message });
  }

  // CLAUDE.md §5.7: a password change signs out every other session.
  await supabase.auth.signOut({ scope: "others" });
  await audit("auth.password_changed", { entityType: "user", entityId: user.id });
  return { ok: true, message: "Your password has been updated. Other devices have been signed out." };
}

// ─── Sign out ──────────────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  const user = await getUser();
  const supabase = await createClient();
  if (user) await audit("auth.sign_out", { entityType: "user", entityId: user.id });
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
