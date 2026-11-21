import { NextResponse } from "next/server";

import { audit } from "@/lib/auth/audit";
import { getUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/**
 * CCPA data export: the signed-in user's own data, read through RLS (the
 * user's session, never the service role). New tables (children, orders,
 * subscriptions) are added here as later phases create them.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const supabase = await createClient();
  const [profile, roles, organizations, identities] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, created_at, updated_at").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role, organization_id, granted_at").eq("user_id", user.id),
    supabase.from("organizations").select("id, name, status, created_at"),
    supabase.auth.getUserIdentities(),
  ]);

  const body = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile: profile.data,
    roles: roles.data ?? [],
    organizations: organizations.data ?? [],
    sign_in_methods: (identities.data?.identities ?? []).map((i) => ({
      provider: i.provider,
      created_at: i.created_at,
    })),
  };

  await audit("account.data_exported", { entityType: "user", entityId: user.id });
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="smart-cookie-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
