"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, type ActionResult } from "@/lib/auth/action-result";
import { audit } from "@/lib/auth/audit";
import { getUser } from "@/lib/auth/guards";
import { secondsSinceLastAuth } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const provider = z.enum(["google", "apple"]);

/** Unlink Google/Apple. At least one sign-in identity must always remain. */
export async function unlinkProvider(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");
  const parsed = provider.safeParse(formData.get("provider"));
  if (!parsed.success) return fail("validation", "Unknown provider.");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUserIdentities();
  const identities = data?.identities ?? [];
  const target = identities.find((i) => i.provider === parsed.data);
  if (!target) return fail("validation", "That sign-in method isn't connected.");
  if (identities.length <= 1) {
    return fail("forbidden", "Add another sign-in method before removing this one, so you can't get locked out.");
  }
  const { error } = await supabase.auth.unlinkIdentity(target);
  if (error) return fail("unknown", "We couldn't disconnect that sign-in method.");
  await audit("auth.identity_unlinked", { entityType: "user", entityId: user.id, metadata: { provider: parsed.data } });
  return { ok: true, message: "Disconnected." };
}

/** Sign out of every device (revokes all refresh tokens). */
export async function signOutEverywhere(): Promise<void> {
  const user = await getUser();
  const supabase = await createClient();
  if (user) await audit("auth.sign_out_everywhere", { entityType: "user", entityId: user.id });
  await supabase.auth.signOut({ scope: "global" });
  redirect("/sign-in");
}

/**
 * Delete the account (CCPA). Requires typing DELETE and a sign-in within the
 * last 10 minutes. Child records and orders arrive in later phases; when they
 * do, this action deletes children, anonymizes orders kept for accounting,
 * cancels Stripe subscriptions and detaches payment methods.
 */
export async function deleteAccount(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("unauthorized", "Please sign in again.");
  if (formData.get("confirm") !== "DELETE") {
    return fail("validation", "Type DELETE to confirm.", { confirm: "Type DELETE to confirm." });
  }
  const age = secondsSinceLastAuth(user.claims);
  if (age === null || age > 600) {
    return fail(
      "step_up_required",
      "For your security, sign out and sign in again, then delete your account within 10 minutes.",
    );
  }

  const supabase = await createClient();
  await supabase.from("profiles").update({ full_name: null, phone: null }).eq("id", user.id);
  await audit("account.deleted", { entityType: "user", entityId: user.id });

  // Service role: deleting an auth user is an Auth admin operation. The user
  // is authenticated and recently re-verified above; RLS can't express this.
  const { error } = await createAdminClient().auth.admin.deleteUser(user.id);
  if (error) {
    return fail(
      "unknown",
      user.roles.includes("owner")
        ? "This is the last owner account. Make someone else an owner first."
        : "We couldn't delete your account. Please contact us.",
    );
  }
  await supabase.auth.signOut({ scope: "local" });
  redirect("/?account=deleted");
}
