"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/auth/audit";
import { getUser } from "@/lib/auth/guards";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const token = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);
const STAFF = ["owner", "ops", "kitchen"];

/**
 * "Repeat last week" from the cutoff reminder email. The single-use token
 * (hashed at rest, valid until that week's cutoff) signs the parent in and
 * opens the order page with last week's meals ready (the order page re-runs
 * every allergy and menu check). Staff accounts are never signed in this way:
 * they must sign in with MFA.
 */
export async function redeemRepeatLink(formData: FormData): Promise<void> {
  const parsed = token.safeParse(formData.get("token"));
  const expired = "/sign-in?next=%2Forder&error=link";
  if (!parsed.success || !(await rateLimit("codeCheck", clientIp(await headers()))).success) redirect(expired);

  // Service role: the token table has no policies (no user session yet) and
  // generating a sign-in link is an admin API.
  const admin = createAdminClient();
  const { data: rows } = await admin.rpc("redeem_deep_link", { p_token: parsed.data });
  const link = (rows as { user_id: string; purpose: string; menu_week_id: string | null }[] | null)?.[0];
  if (!link || link.purpose !== "repeat_last_week") redirect(expired);
  const next = link.menu_week_id ? `/order?week=${link.menu_week_id}&repeat=1` : "/order";

  const current = await getUser();
  if (current?.id === link.user_id) redirect(next);
  const signIn = `/sign-in?next=${encodeURIComponent(next)}`;
  if (current) redirect(signIn); // someone else is signed in on this device: don't switch accounts silently

  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", link.user_id);
  if ((roles ?? []).some((r) => STAFF.includes(r.role as string))) redirect(signIn);
  const { data: u } = await admin.auth.admin.getUserById(link.user_id);
  if (!u?.user?.email) redirect(signIn);
  const { data: gen, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (error || !gen?.properties?.hashed_token) redirect(signIn);
  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: gen.properties.hashed_token,
  });
  if (verifyError) redirect(signIn);
  await audit("auth.sign_in", { entityType: "user", entityId: link.user_id, metadata: { method: "repeat_link" } });
  redirect(next);
}
