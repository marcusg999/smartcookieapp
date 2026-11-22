import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { expect, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, PASSWORD, uniqueEmail } from "./support/supabase";

import type { Page } from "@playwright/test";

// Phase 5: the family experience, end to end. CI pays with the mock; with a
// real Stripe test key the payment is confirmed with a test card.
const MOCK = /^(sk|rk)_test_(ci_)?dummy$/.test(process.env.STRIPE_SECRET_KEY ?? "");
test.describe.configure({ mode: "parallel" });

type Week = { id: string; week_start: string; delivery_dates: string[] };

/** The first week a family can order right now (published, opened, before cutoff). */
async function openWeek(): Promise<Week> {
  const { data } = await admin
    .from("menu_weeks")
    .select("id, week_start, delivery_dates, ordering_opens_at, cutoff_at")
    .eq("status", "published")
    .order("week_start");
  for (const w of data ?? []) {
    const { data: cutoff } = await admin.rpc("menu_week_cutoff", { p_week: w.id });
    if (
      Date.parse(cutoff as string) > Date.now() &&
      (!w.ordering_opens_at || Date.parse(w.ordering_opens_at) <= Date.now())
    )
      return w;
  }
  throw new Error("no open week in the seed");
}

async function mealId(slug: string): Promise<string> {
  const { data } = await admin.from("menu_items").select("id").eq("slug", slug).single();
  return data!.id as string;
}

/** A parent with a household, address (Pasadena zone) and the given children. */
async function makeFamily(kids: { name: string; allergies?: string[] }[], onboarded = true) {
  const email = uniqueEmail("parent");
  const userId = await createUser(email);
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const householdId = hm!.household_id as string;
  const { data: addr } = await admin
    .from("addresses")
    .insert({ household_id: householdId, line1: "1 Test Way", city: "Pasadena", zip: "91105", is_default: true })
    .select("id")
    .single();
  await admin
    .from("households")
    .update({ default_address_id: addr!.id, onboarded_at: onboarded ? new Date().toISOString() : null })
    .eq("id", householdId);
  const childIds: string[] = [];
  for (const k of kids) {
    const { data: child } = await admin
      .from("children")
      .insert({ household_id: householdId, first_name: k.name })
      .select("id")
      .single();
    childIds.push(child!.id as string);
    for (const slug of k.allergies ?? []) {
      const { data: a } = await admin.from("allergens").select("id").eq("slug", slug).single();
      await admin.from("child_allergens").insert({ child_id: child!.id, allergen_id: a!.id, severity: "allergy" });
    }
  }
  return { email, userId, householdId, childIds };
}

/** Fill a controlled input, re-filling if hydration reset it. */
async function fillStable(locator: import("@playwright/test").Locator, value: string) {
  await expect(async () => {
    await locator.fill(value);
    await expect(locator).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 20_000 });
}

async function goToOrder(page: Page, email: string) {
  await signInWithPassword(page, email, "/order");
  await expect(page).toHaveURL(/\/order/);
}

test("first-time parent: onboarding → order for two kids → allergy confirmation → pay", async ({ page }) => {
  test.slow();
  const email = uniqueEmail("newparent");
  const userId = await createUser(email);
  await signInWithPassword(page, email);

  // First sign-in lands on the welcome steps.
  await expect(page).toHaveURL(/\/welcome/);
  await fillStable(page.getByLabel("Household name"), "The Testers");
  await page.getByRole("button", { name: "Continue" }).click();

  // ZIP inside a zone, then the address.
  await fillStable(page.getByLabel("ZIP code").first(), "91105");
  await page.getByRole("button", { name: "Check my ZIP" }).click();
  await expect(page.getByText(/we deliver to Pasadena/i)).toBeVisible();
  await page.getByLabel("Street address").fill("12 Lemon Grove");
  await page.getByLabel("City").fill("Pasadena");
  await page.getByRole("button", { name: "Continue" }).click();

  // Two kids; the first is allergic to peanuts.
  await expect(page.getByRole("heading", { name: "Add your kids" })).toBeVisible();
  await page.getByRole("button", { name: "Peanuts" }).click();
  await expect(page.getByRole("button", { name: "Peanuts" })).toHaveAttribute("aria-pressed", "true");
  await fillStable(page.getByLabel("First name"), "Pip");
  await page.getByRole("button", { name: "Save child" }).click();
  await expect(page.getByRole("heading", { name: "Pip" })).toBeVisible();
  await page.getByRole("button", { name: "Add another child" }).click();
  await fillStable(page.getByLabel("First name"), "Quinn");
  await page.getByRole("button", { name: "Save child" }).click();
  await expect(page.getByRole("heading", { name: "Quinn" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByText("Pick à la carte each week").click();
  await page.getByRole("button", { name: "Start ordering" }).click();
  await expect(page).toHaveURL(/\/order/);

  // A meal for each child.
  await page
    .getByRole("button", { name: /Add for Pip: Baked mac & cheese|Add for Pip: Teriyaki chicken & rice/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /^Add: / })
    .first()
    .click(); // a second portion (over the delivery minimum)
  await page.getByRole("tab", { name: /Quinn/ }).click();
  await page
    .getByRole("button", { name: /Add for Quinn: Turkey & avocado wrap|Add for Quinn: Black bean quesadilla/ })
    .first()
    .click();
  await expect(page.getByText("3 meals")).toBeVisible();
  await page.getByRole("link", { name: "Review & check out" }).click();

  // Review → delivery → allergy confirmation (last step) → pay.
  await expect(page.getByRole("heading", { name: "Pip" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Are these still correct for each child?" })).toBeVisible();
  await expect(page.getByText("Peanuts").first()).toBeVisible();
  await page.getByRole("button", { name: "Still correct" }).first().click();
  await page.getByRole("button", { name: "Still correct" }).first().click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
  if (MOCK) {
    await page.getByRole("button", { name: /^Pay \$/ }).click();
  } else {
    // Real Stripe test mode: confirm with a test card through the API (the
    // dev sandbox can't run Stripe.js's own confirm; see payments.spec.ts).
    const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
    const { data: o } = await admin.from("orders").select("id").eq("household_id", hm!.household_id).single();
    await expect
      .poll(async () => (await admin.from("order_payments").select("id").eq("order_id", o!.id)).data?.length ?? 0, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const { data: p } = await admin
      .from("order_payments")
      .select("stripe_payment_intent_id")
      .eq("order_id", o!.id)
      .single();
    await new Stripe(process.env.STRIPE_SECRET_KEY!, {
      httpClient: Stripe.createFetchHttpClient(),
    }).paymentIntents.confirm(p!.stripe_payment_intent_id, { payment_method: "pm_card_visa", return_url: page.url() });
    await page.goto(`/checkout?order=${o!.id}&redirect_status=succeeded`);
  }
  await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible();

  // The order is stored as paid, with the allergy confirmation and a server-computed total.
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const { data: orders } = await admin
    .from("orders")
    .select("status, total_cents, allergy_confirmed_by")
    .eq("household_id", hm!.household_id);
  expect(orders).toHaveLength(1);
  expect(orders![0]).toMatchObject({ status: "paid", allergy_confirmed_by: userId });
  expect(orders![0]!.total_cents).toBeGreaterThan(0);
});

test("a peanut-allergic child cannot be given a peanut meal (UI and database)", async ({ page }) => {
  const fam = await makeFamily([{ name: "Nutty", allergies: ["peanuts"] }]);
  await goToOrder(page, fam.email);
  const card = page.getByRole("listitem").filter({ hasText: "Peanut noodle bowl" });
  await expect(card.getByText("Unavailable for Nutty")).toBeVisible();
  await expect(card.getByText(/Contains Peanuts, which is on Nutty's allergy list/)).toBeVisible();
  await expect(card.getByRole("button", { name: /Add for Nutty/ })).toHaveCount(0);

  // Bypass the UI: call the database function with the parent's own session.
  const week = await openWeek();
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  await client.auth.signInWithPassword({ email: fam.email, password: PASSWORD });
  const { error } = await client.rpc("place_family_order", {
    p_household: fam.householdId,
    p_menu_week: week.id,
    p_items: [
      {
        child_id: fam.childIds[0],
        menu_item_id: await mealId("peanut-noodle-bowl"),
        quantity: 1,
        delivery_date: week.delivery_dates[0],
      },
    ],
    p_fulfillment: "delivery",
    p_address: (await admin.from("households").select("default_address_id").eq("id", fam.householdId).single()).data!
      .default_address_id,
    p_allergies_confirmed: true,
  });
  expect(error?.message).toMatch(/ALLERGY_BLOCK/);
});

test("repeat last week fills the cart in one tap from the account home", async ({ page }) => {
  const fam = await makeFamily([{ name: "Remy" }]);
  const week = await openWeek();
  // A previous week's order (any earlier week; status doesn't matter for "last week").
  const { data: earlier } = await admin
    .from("menu_weeks")
    .select("id, week_start, delivery_dates")
    .lt("week_start", week.week_start)
    .order("week_start", { ascending: false })
    .limit(1)
    .single();
  const mac = await mealId("baked-mac-and-cheese");
  const gone = await mealId("salmon-sweet-potato"); // may not be on this week's menu → swap
  const { data: order } = await admin
    .from("orders")
    .insert({
      household_id: fam.householdId,
      menu_week_id: earlier!.id,
      status: "paid",
      placed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  await admin.from("order_items").insert([
    {
      order_id: order!.id,
      child_id: fam.childIds[0],
      menu_item_id: mac,
      delivery_date: earlier!.week_start,
      quantity: 1,
      unit_price_cents: 895,
      item_name: "Baked mac & cheese",
    },
    {
      order_id: order!.id,
      child_id: fam.childIds[0],
      menu_item_id: gone,
      delivery_date: earlier!.week_start,
      quantity: 1,
      unit_price_cents: 1095,
      item_name: "Salmon bites & sweet potato",
    },
  ]);

  await signInWithPassword(page, fam.email);
  await expect(page).toHaveURL(/\/account/);
  // Tap 1: Repeat last week.
  await page.getByRole("link", { name: "Repeat last week" }).click();
  await expect(page.getByText("2 meals")).toBeVisible();
  await expect(page.getByText("Last week's picks are in.")).toBeVisible();
  // Tap 2: review & check out.
  await page.getByRole("link", { name: "Review & check out" }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText("Remy")).toBeVisible();
});

test("ordering after the cutoff is rejected by the server even if the UI is bypassed", async () => {
  const fam = await makeFamily([{ name: "Late" }]);
  // A published week whose cutoff has passed (the seed's next week often is; else force one).
  const { data: weeks } = await admin
    .from("menu_weeks")
    .select("id, delivery_dates, cutoff_at")
    .eq("status", "published")
    .order("week_start");
  const week = weeks![weeks!.length - 1]!;
  const originalCutoff = week.cutoff_at;
  await admin
    .from("menu_weeks")
    .update({ cutoff_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", week.id);
  try {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    await client.auth.signInWithPassword({ email: fam.email, password: PASSWORD });
    const { data: hh } = await admin.from("households").select("default_address_id").eq("id", fam.householdId).single();
    const { error } = await client.rpc("place_family_order", {
      p_household: fam.householdId,
      p_menu_week: week.id,
      p_items: [
        {
          child_id: fam.childIds[0],
          menu_item_id: await mealId("baked-mac-and-cheese"),
          quantity: 1,
          delivery_date: week.delivery_dates[0],
        },
      ],
      p_fulfillment: "delivery",
      p_address: hh!.default_address_id,
      p_allergies_confirmed: true,
    });
    expect(error?.message).toBe("Ordering for this week is closed");
  } finally {
    await admin.from("menu_weeks").update({ cutoff_at: originalCutoff }).eq("id", week.id);
  }
});

test("public pages render from the CMS: plans, schools, FAQ, sitemap", async ({ page }) => {
  await page.goto("/plans");
  await expect(page.getByRole("heading", { level: 1, name: "Plans & pricing" })).toBeVisible();
  await page.goto("/schools");
  await expect(page.getByRole("heading", { level: 1, name: "Lunch for the whole class." })).toBeVisible();
  await page.goto("/faq");
  await expect(page.getByRole("heading", { level: 1, name: "Questions, answered" })).toBeVisible();
  const sitemap = await page.request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("/plans");
  await page.goto("/");
  const ld = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(ld!)["@type"]).toBe("LocalBusiness");
});
