import { createClient } from "@supabase/supabase-js";

import { expect, newContext, test } from "./support/fixtures";
import { waitForEmailLink } from "./support/mailpit";
import { admin, createUser, PASSWORD, uniqueEmail } from "./support/supabase";

// Phase 10 security review: attacks a signed-in parent (or a visitor) might
// try, run against the real app and API. See docs/security-review.md.
test.describe.configure({ mode: "parallel" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** A parent signed in to the API directly (what an attacker with devtools has). */
async function parentApi() {
  const email = uniqueEmail("attacker");
  const userId = await createUser(email);
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  return { client, email, userId, householdId: hm!.household_id as string };
}

/** Someone else's order, child and address (seed data). */
async function victim() {
  const { data: order } = await admin
    .from("orders")
    .select("id, household_id")
    .not("household_id", "is", null)
    .limit(1)
    .single();
  const { data: child } = await admin
    .from("children")
    .select("id")
    .eq("household_id", order!.household_id)
    .limit(1)
    .single();
  return { orderId: order!.id as string, householdId: order!.household_id as string, childId: child?.id as string };
}

test("IDOR: a parent can't read or change another household's orders, children or addresses", async ({ page }) => {
  const a = await parentApi();
  const v = await victim();
  expect((await a.client.from("orders").select("id").eq("id", v.orderId)).data).toEqual([]);
  expect((await a.client.from("order_items").select("id").eq("order_id", v.orderId)).data).toEqual([]);
  expect((await a.client.from("children").select("id").eq("household_id", v.householdId)).data).toEqual([]);
  expect((await a.client.from("addresses").select("id").eq("household_id", v.householdId)).data).toEqual([]);
  expect((await a.client.from("child_allergens").select("child_id").eq("child_id", v.childId)).data).toEqual([]);
  // Writes to someone else's rows match nothing (RLS) or are refused.
  const upd = await a.client.from("children").update({ first_name: "Pwned" }).eq("id", v.childId).select("id");
  expect(upd.data ?? []).toEqual([]);
  const { data: still } = await admin.from("children").select("first_name").eq("id", v.childId).single();
  expect(still!.first_name).not.toBe("Pwned");

  // The page for someone else's order is a 404, not their details.
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/(account|welcome)/);
  const res = await page.goto(`/orders/${v.orderId}`);
  expect(res!.status()).toBe(404);
});

test("privilege escalation and mass assignment through the API are refused", async () => {
  const a = await parentApi();
  // Grant yourself the owner role.
  const role = await a.client.from("user_roles").insert({ user_id: a.userId, role: "owner" });
  expect(role.error).not.toBeNull();
  const rpc = await a.client.rpc("grant_role", { p_user: a.userId, p_role: "owner", p_org: null });
  expect(rpc.error).not.toBeNull();
  // Write an order (or its price) directly instead of through the checked functions.
  const ins = await a.client.from("orders").insert({ household_id: a.householdId, total_cents: 1, status: "paid" });
  expect(ins.error).not.toBeNull();
  // Change server-owned household fields (Stripe customer, onboarding).
  await a.client.from("households").update({ stripe_customer_id: "cus_attacker" }).eq("id", a.householdId);
  const { data: hh } = await admin.from("households").select("stripe_customer_id").eq("id", a.householdId).single();
  expect(hh!.stripe_customer_id).not.toBe("cus_attacker");
  // Read the audit log, the email log, Stripe events, or other people's roles.
  for (const table of ["audit_log", "notifications_log", "stripe_events"] as const) {
    const { data } = await a.client.from(table).select("*").limit(5);
    expect(data ?? [], table).toEqual([]);
  }
  const { data: roles } = await a.client.from("user_roles").select("user_id");
  expect((roles ?? []).every((r) => r.user_id === a.userId)).toBe(true);
  // Rewrite published site copy through the public views (SR-01).
  const view = await a.client.from("content_blocks_public").update({ value: "PWNED" }).eq("key", "home.hero.title");
  expect(view.error).not.toBeNull();
});

test("a magic link works once; reusing it is rejected @local-only", async ({ page, browser }) => {
  const email = uniqueEmail("magic-reuse");
  await createUser(email);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  const link = await waitForEmailLink(email, { subject: /sign-in link/ });
  await page.goto(link);
  await expect(page).toHaveURL(/\/(account|welcome)/);
  const ctx = await newContext(browser);
  const again = await ctx.newPage();
  await again.goto(link);
  await expect(again).toHaveURL(/\/sign-in\?error=link/);
  await ctx.close();
});

test("password guessing is rate limited, with the same generic message for every failure @local-only", async ({
  page,
}) => {
  const email = uniqueEmail("brute");
  await createUser(email);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  const attempt = async (i: number) => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(`wrong-password-${i}-xxxx`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await attempt(0);
  await expect(page.getByText(/couldn't sign you in with those details/)).toBeVisible();
  // The limit is 5 per minute per IP: the sixth try is refused before checking the password.
  for (let i = 1; i < 6; i++) await attempt(i);
  await expect(page.getByText("Too many attempts. Please wait a minute and try again.")).toBeVisible();
});

test("open redirects: next= only goes to same-site paths", async ({ page }) => {
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
    const res = await page.goto(`/auth/after-sign-in?next=${encodeURIComponent(next)}`);
    expect(new URL(page.url()).host, next).toBe(new URL(res!.url()).host);
    expect(page.url()).not.toContain("evil.example");
  }
});

test("CCPA: a parent exports all their data, then deleting the account closes the household", async ({ page }) => {
  const email = uniqueEmail("ccpa");
  const userId = await createUser(email);
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const householdId = hm!.household_id as string;
  const { data: child } = await admin
    .from("children")
    .insert({ household_id: householdId, first_name: "Exporty" })
    .select("id")
    .single();
  const { data: sesame } = await admin.from("allergens").select("id").eq("slug", "sesame").single();
  await admin.from("child_allergens").insert({ child_id: child!.id, allergen_id: sesame!.id, severity: "severe" });

  await page.goto("/sign-in?next=/account/privacy");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/privacy/);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Download my data/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^smart-cookie-data-.*\.json$/);
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(data.account.email).toBe(email);
  expect(data.children[0].first_name).toBe("Exporty");
  expect(JSON.stringify(data.children[0].child_allergens)).toContain("Sesame");
  for (const key of ["households", "addresses", "orders", "subscriptions", "favorites", "saved_orders"])
    expect(data, key).toHaveProperty(key);

  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: /Delete my account/ }).click();
  await expect(page).toHaveURL(/account=deleted/);
  const { data: hh } = await admin.from("households").select("closed_at").eq("id", householdId).single();
  expect(hh!.closed_at).not.toBeNull();
  const { data: archived } = await admin.from("children").select("archived_at").eq("id", child!.id).single();
  expect(archived!.archived_at).not.toBeNull();
  const { data: gone } = await admin.auth.admin.getUserById(userId);
  expect(gone.user).toBeNull();
});
