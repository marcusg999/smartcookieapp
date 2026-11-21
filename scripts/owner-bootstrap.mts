/**
 * One-time owner bootstrap (CLAUDE.md Phase 2 §5):
 *
 *   pnpm owner:bootstrap owner@example.com
 *
 * Grants `owner` to an EXISTING, email-verified user, using the service role.
 * It refuses to run if any owner already exists: after the first owner,
 * owners are managed in /admin/staff (with MFA step-up). No UI path can
 * create the first owner.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the
 * environment (.env.local is loaded automatically if present). Point it at
 * staging/production only deliberately, with that environment's keys.
 */
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: pnpm owner:bootstrap <email>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  process.exit(1);
}

// Service role: this script exists precisely to do the one thing no user can
// do through RLS, grant the first owner role.
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(target: string) {
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === target);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const { count, error: countError } = await admin
  .from("user_roles")
  .select("*", { count: "exact", head: true })
  .eq("role", "owner");
if (countError) throw countError;
if ((count ?? 0) > 0) {
  console.error("An owner already exists. Manage owners from /admin/staff instead.");
  process.exit(1);
}

const user = await findUser(email);
if (!user) {
  console.error(`No account found for ${email}. Sign up first, confirm the email, then re-run.`);
  process.exit(1);
}
if (!user.email_confirmed_at) {
  console.error(`${email} hasn't confirmed their email yet. Confirm it first, then re-run.`);
  process.exit(1);
}

const { error: insertError } = await admin.from("user_roles").insert({ user_id: user.id, role: "owner" });
if (insertError) throw insertError;

await admin.rpc("log_audit_event", {
  p_action: "staff.owner_bootstrapped",
  p_entity_type: "user",
  p_entity_id: user.id,
  p_metadata: { source: "scripts/owner-bootstrap.mts" },
});

console.log(`✓ ${email} is now the owner. Sign in and visit /admin to set up two-factor authentication.`);
