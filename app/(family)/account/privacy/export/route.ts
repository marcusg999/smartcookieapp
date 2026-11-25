import { NextResponse } from "next/server";

import { audit } from "@/lib/auth/audit";
import { getUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/**
 * CCPA data export: the signed-in user's own data, read through RLS (the
 * user's session, never the service role): account, household, children and
 * their allergies, addresses, orders, plans, favourites, saved orders and
 * email preferences. (Phase 10: completed for every family table.)
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const supabase = await createClient();
  const [
    profile,
    roles,
    organizations,
    identities,
    households,
    children,
    addresses,
    orders,
    subscriptions,
    favorites,
    savedOrders,
    emailPreferences,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, created_at, updated_at").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role, organization_id, granted_at").eq("user_id", user.id),
    supabase.from("organizations").select("id, name, status, created_at"),
    supabase.auth.getUserIdentities(),
    supabase.from("households").select("id, name, ordering_preference, onboarded_at, created_at"),
    supabase
      .from("children")
      .select(
        "id, first_name, last_initial, grade, dietary_preferences, notes, archived_at, created_at, child_allergens ( severity, allergens ( name ) )",
      ),
    supabase.from("addresses").select("line1, line2, city, state, zip, delivery_notes, is_default, created_at"),
    supabase
      .from("orders")
      .select(
        "order_number, status, fulfillment, delivery_date, subtotal_cents, discount_cents, tax_cents, total_cents, amount_refunded_cents, currency, allergy_confirmed_at, created_at, order_items ( item_name, quantity, unit_price_cents, delivery_date, allergens_contained, may_contain )",
      )
      .order("created_at"),
    supabase
      .from("subscriptions")
      .select(
        "status, quantity, current_period_end, cancel_at_period_end, renewal_terms, renewal_consent_at, created_at",
      ),
    supabase.from("favorites").select("menu_item_id, child_id, created_at"),
    supabase.from("saved_orders").select("name, payload, created_at"),
    supabase.from("email_preferences").select("menu_published, cutoff_reminders, updated_at").maybeSingle(),
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
    households: households.data ?? [],
    children: children.data ?? [],
    addresses: addresses.data ?? [],
    orders: orders.data ?? [],
    subscriptions: subscriptions.data ?? [],
    favorites: favorites.data ?? [],
    saved_orders: savedOrders.data ?? [],
    email_preferences: emailPreferences.data,
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
