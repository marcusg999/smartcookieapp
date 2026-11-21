import { createClient } from "@supabase/supabase-js";

import { totp } from "./totp";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Service role: test fixtures only (creating users and granting roles directly).
export const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

export const PASSWORD = "Correct-horse-battery-42";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export async function createUser(email: string, roles: string[] = []): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  for (const role of roles) {
    const { error: roleError } = await admin.from("user_roles").insert({ user_id: data.user.id, role });
    if (roleError) throw roleError;
  }
  return data.user.id;
}

/** Enroll and verify a TOTP factor through the API; returns the secret. */
export async function enrollTotp(email: string): Promise<string> {
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) throw error ?? new Error("enroll failed");
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totp(data.totp.secret),
  });
  if (verifyError) throw verifyError;
  await client.auth.signOut({ scope: "local" });
  return data.totp.secret;
}
