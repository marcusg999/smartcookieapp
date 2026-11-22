import Stripe from "stripe";

import { expect, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, uniqueEmail } from "./support/supabase";

import type { FrameLocator, Page } from "@playwright/test";

// Phase 6: REAL Stripe test-mode payments, skipped with the placeholder keys
// CI uses. Run locally with a test key and the webhook forwarder (or Stripe
// CLI) running; behind an HTTPS proxy also set PLAYWRIGHT_PROXY.
//
// The browser renders the real Payment Element and the card fields are
// filled, but the PaymentIntent is confirmed through Stripe's API with
// Stripe's test cards. (In the development sandbox a network proxy injects
// the secret key into every api.stripe.com request, which breaks Stripe.js's
// own confirm call; real browsers aren't affected.) 3D Secure is completed
// on Stripe's real test page, and the app's return/processing screen settles
// the order from Stripe (webhook, or the server-side reconcile).
const MOCK = /^(sk|rk)_test_(ci_)?dummy$/.test(process.env.STRIPE_SECRET_KEY ?? "");
test.skip(MOCK, "real Stripe test mode only");
test.skip(({ isMobile }) => isMobile, "payment flows run once, on desktop");
test.describe.configure({ mode: "parallel" });
test.slow();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-11-18.endive",
  httpClient: Stripe.createFetchHttpClient(),
});

async function familyWithCart() {
  const email = uniqueEmail("pay");
  const userId = await createUser(email);
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const householdId = hm!.household_id as string;
  const { data: addr } = await admin
    .from("addresses")
    .insert({ household_id: householdId, line1: "1 Pay St", city: "Pasadena", zip: "91105", is_default: true })
    .select("id")
    .single();
  await admin
    .from("households")
    .update({ default_address_id: addr!.id, onboarded_at: new Date().toISOString() })
    .eq("id", householdId);
  const { data: child } = await admin
    .from("children")
    .insert({ household_id: householdId, first_name: "Penny" })
    .select("id")
    .single();

  // First open week + three mains (over the delivery minimum).
  const { data: weeks } = await admin
    .from("menu_weeks")
    .select("id, delivery_dates")
    .eq("status", "published")
    .order("week_start");
  let week: { id: string; delivery_dates: string[] } | undefined;
  for (const w of weeks ?? []) {
    const { data: cutoff } = await admin.rpc("menu_week_cutoff", { p_week: w.id });
    if (Date.parse(cutoff as string) > Date.now()) {
      week = w;
      break;
    }
  }
  const { data: items } = await admin
    .from("menu_week_items")
    .select("menu_item_id, menu_items!inner ( is_snack, menu_item_allergens ( allergen_id ) )")
    .eq("menu_week_id", week!.id)
    .eq("menu_items.is_snack", false)
    .limit(3);
  const lines = (items ?? []).map((i) => ({
    child_id: child!.id,
    menu_item_id: i.menu_item_id,
    delivery_date: week!.delivery_dates[0],
    quantity: 1,
  }));
  await admin.from("carts").insert({ household_id: householdId, menu_week_id: week!.id, lines });
  return { email, householdId, weekId: week!.id };
}

async function checkoutToPayment(page: Page, email: string, weekId: string) {
  await signInWithPassword(page, email, `/checkout?week=${weekId}`);
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "All correct, place order" }).click();
  await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
}

function paymentFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Secure payment input frame"]').first();
}

async function fillCard(page: Page, number: string) {
  const frame = paymentFrame(page);
  await frame.getByRole("textbox", { name: "Card number" }).fill(number, { timeout: 30_000 });
  await frame.getByRole("textbox", { name: /Expiration/ }).fill("12 / 34");
  await frame.getByRole("textbox", { name: /Security code|CVC/ }).fill("123");
  const zip = frame.getByRole("textbox", { name: /ZIP/ });
  if (await zip.count()) await zip.fill("91105");
}

async function orderFor(householdId: string) {
  const { data } = await admin
    .from("orders")
    .select("id, status, total_cents, amount_paid_cents, stripe_payment_intent_id, last_payment_error")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!;
}

async function confirmWith(orderId: string, paymentMethod: string, returnUrl: string) {
  // The payment step creates the PaymentIntent when it opens.
  await expect
    .poll(async () => (await admin.from("order_payments").select("id").eq("order_id", orderId)).data?.length ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  const { data: pay } = await admin
    .from("order_payments")
    .select("stripe_payment_intent_id")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return stripe.paymentIntents
    .confirm(pay!.stripe_payment_intent_id, { payment_method: paymentMethod, return_url: returnUrl })
    .catch((e: Stripe.errors.StripeError) => {
      if (!e.payment_intent) throw e;
      return e.payment_intent;
    });
}

test("card 4242: paid, and Stripe charged exactly the server-computed total", async ({ page, baseURL }) => {
  const fam = await familyWithCart();
  await checkoutToPayment(page, fam.email, fam.weekId);
  await fillCard(page, "4242424242424242"); // the real Payment Element renders and accepts input
  const order = await orderFor(fam.householdId);
  const back = `${baseURL}/checkout?order=${order.id}`;
  const pi = await confirmWith(order.id, "pm_card_visa", back);
  expect(pi?.status).toBe("succeeded");
  await page.goto(`${back}&redirect_status=succeeded`);
  await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible({ timeout: 60_000 });
  const paid = await orderFor(fam.householdId);
  expect(paid.status).toBe("paid");
  const remote = await stripe.paymentIntents.retrieve(paid.stripe_payment_intent_id!);
  expect(remote.amount).toBe(paid.total_cents); // amount comes from the database, not the browser
  expect(remote.metadata.order_id).toBe(paid.id);
  expect(remote.setup_future_usage).toBe("off_session"); // saved for change top-ups
});

test("3D Secure: Stripe's challenge page, then paid", async ({ page, baseURL }) => {
  const fam = await familyWithCart();
  await checkoutToPayment(page, fam.email, fam.weekId);
  const order = await orderFor(fam.householdId);
  const back = `${baseURL}/checkout?order=${order.id}`;
  const pi = await confirmWith(order.id, "pm_card_authenticationRequired", back);
  expect(pi?.status).toBe("requires_action");
  const url = pi?.next_action?.redirect_to_url?.url;
  expect(url).toBeTruthy();
  await page.goto(url!);
  // Stripe's 3DS2 test page: an outer frame with a dialog holding the challenge frame.
  await page
    .frameLocator("iframe")
    .first()
    .frameLocator("iframe")
    .first()
    .getByRole("button", { name: /complete/i })
    .first()
    .click({ timeout: 60_000 });
  await page.waitForURL(/\/checkout\?order=/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible({ timeout: 60_000 });
  expect((await orderFor(fam.householdId)).status).toBe("paid");
});

test("declined card (insufficient funds): clear error, order stays unpaid", async ({ page, baseURL }) => {
  const fam = await familyWithCart();
  await checkoutToPayment(page, fam.email, fam.weekId);
  const order = await orderFor(fam.householdId);
  const back = `${baseURL}/checkout?order=${order.id}`;
  await confirmWith(order.id, "pm_card_chargeDeclinedInsufficientFunds", back);
  await page.goto(`${back}&redirect_status=processing`);
  await expect(page.getByRole("alert").filter({ hasText: /insufficient funds/i })).toBeVisible({ timeout: 60_000 });
  expect((await orderFor(fam.householdId)).status).toBe("pending_payment");
});

test("changing a paid order before cutoff: more → charged off-session, less → refunded", async ({ page, baseURL }) => {
  const fam = await familyWithCart();
  await checkoutToPayment(page, fam.email, fam.weekId);
  const order = await orderFor(fam.householdId);
  const back = `${baseURL}/checkout?order=${order.id}`;
  await confirmWith(order.id, "pm_card_visa", back);
  await page.goto(`${back}&redirect_status=succeeded`);
  await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible({ timeout: 60_000 });
  const paidTotal = (await orderFor(fam.householdId)).total_cents;

  // Add one more meal through "Change order".
  await page.goto(`/orders/${order.id}`);
  await page.getByRole("button", { name: "Change order" }).click();
  await expect(page).toHaveURL(/\/order\?week=/);
  await page.getByRole("button", { name: /^Add: / }).first().click();
  await page.getByRole("link", { name: "Review & check out" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "All correct, place order" }).click();
  await expect(page.getByText(/We charged \$\d+\.\d\d for your changes/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await orderFor(fam.householdId)).status, { timeout: 60_000 }).toBe("paid");
  const afterAdd = await orderFor(fam.householdId);
  expect(afterAdd.total_cents).toBeGreaterThan(paidTotal);
  expect(afterAdd.amount_paid_cents).toBe(afterAdd.total_cents); // the top-up was charged off-session

  // Remove a meal → the difference is refunded.
  await page.goto(`/orders/${order.id}`);
  await page.getByRole("button", { name: "Change order" }).click();
  await page.getByRole("button", { name: /^Remove: / }).first().click();
  await page.getByRole("link", { name: "Review & check out" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "All correct, place order" }).click();
  await expect(page.getByText(/We refunded \$\d+\.\d\d/)).toBeVisible({ timeout: 60_000 });
  const pis = await admin.from("order_payments").select("stripe_payment_intent_id").eq("order_id", order.id);
  const refunds = await Promise.all((pis.data ?? []).map((p) => stripe.refunds.list({ payment_intent: p.stripe_payment_intent_id })));
  expect(refunds.flatMap((r) => r.data).length).toBeGreaterThan(0);
});
