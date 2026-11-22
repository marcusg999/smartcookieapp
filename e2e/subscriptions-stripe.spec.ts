import Stripe from "stripe";

import { expect, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, uniqueEmail } from "./support/supabase";

// Phase 6: a family plan's whole life against REAL Stripe test mode, driven
// by a test clock: start → week allowances → skip credit → pause/resume →
// renewal creates the next allowances → a failed renewal goes past due.
// Needs the webhook forwarder (pnpm stripe:forward) or `stripe listen`.
// The test clock (and everything attached to it) is deleted at the end.
const MOCK = /^(sk|rk)_test_(ci_)?dummy$/.test(process.env.STRIPE_SECRET_KEY ?? "");
test.skip(MOCK, "real Stripe test mode only");
test.skip(({ isMobile }) => isMobile, "runs once, on desktop");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-11-18.endive",
  httpClient: Stripe.createFetchHttpClient(),
});

async function advance(clockId: string, to: number) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  await expect
    .poll(async () => (await stripe.testHelpers.testClocks.retrieve(clockId)).status, { timeout: 120_000, intervals: [2000] })
    .toBe("ready");
}

test("plan lifecycle with a test clock: allowances, skip credit, pause, renewal, failed payment", async ({ page, baseURL }) => {
  test.setTimeout(8 * 60_000);
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: "smartcookie-e2e" });
  try {
    // Family + a Stripe customer on the test clock (the app re-uses it).
    const email = uniqueEmail("plan");
    const userId = await createUser(email);
    const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
    const householdId = hm!.household_id as string;
    await admin.from("children").insert({ household_id: householdId, first_name: "Sunny" });
    await admin.from("households").update({ onboarded_at: new Date().toISOString() }).eq("id", householdId);
    const customer = await stripe.customers.create({ email, test_clock: clock.id, metadata: { household_id: householdId, e2e: "subscriptions" } });
    await admin.from("households").update({ stripe_customer_id: customer.id }).eq("id", householdId);

    // 1) Start the plan in the app: it creates the Stripe subscription and the payment step.
    await signInWithPassword(page, email, "/subscription");
    await expect(page).toHaveURL(/\/subscription/);
    const card = page.getByRole("listitem").filter({ hasText: "3 Lunches / week / child" });
    await card.getByRole("button", { name: "Start this plan" }).click();
    await expect(page.getByRole("heading", { name: "Start your plan" })).toBeVisible({ timeout: 30_000 });
    const { data: sub } = await admin.from("subscriptions").select("id, stripe_subscription_id").eq("household_id", householdId).single();
    expect(sub!.stripe_subscription_id).toMatch(/^sub_/);

    // Confirm the first invoice with a test card (the browser's Stripe.js confirm
    // can't run in the dev sandbox; see e2e/payments.spec.ts).
    const stripeSub = await stripe.subscriptions.retrieve(sub!.stripe_subscription_id!, { expand: ["latest_invoice.confirmation_secret"] });
    const secret = (stripeSub.latest_invoice as Stripe.Invoice).confirmation_secret!.client_secret;
    const piId = secret.split("_secret_")[0]!;
    await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa", return_url: `${baseURL}/subscription` });

    // invoice.paid (via webhook) → active, with allowances for the weeks in the period.
    await expect
      .poll(async () => (await admin.from("subscriptions").select("status").eq("id", sub!.id).single()).data?.status, { timeout: 90_000 })
      .toBe("active");
    const allowanceCount = async () =>
      (await admin.from("subscription_allowances").select("id", { count: "exact", head: true }).eq("subscription_id", sub!.id)).count ?? 0;
    const firstCount = await allowanceCount();
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // 2) Skip a week in the app → a credit on the Stripe customer balance.
    await page.reload();
    const weekRow = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Skip this week" }) }).first();
    await weekRow.getByRole("button", { name: "Skip this week" }).click();
    await expect(page.getByText(/will come off your next bill/)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await stripe.customers.retrieve(customer.id) as Stripe.Customer).balance, { timeout: 30_000 }).toBeLessThan(0);

    // 3) Pause (Stripe pause_collection) and resume.
    await page.getByRole("button", { name: "Pause" }).click();
    await expect.poll(async () => (await stripe.subscriptions.retrieve(sub!.stripe_subscription_id!)).pause_collection?.behavior, { timeout: 30_000 }).toBe("void");
    await page.getByRole("button", { name: "Resume now" }).click();
    await expect.poll(async () => (await stripe.subscriptions.retrieve(sub!.stripe_subscription_id!)).pause_collection, { timeout: 30_000 }).toBeNull();

    // 4) Renewal: advance a week → invoice.paid → next weeks' allowances; the skip credit is used.
    const periodEnd = (await stripe.subscriptions.retrieve(sub!.stripe_subscription_id!)).items.data[0]!.current_period_end;
    await advance(clock.id, periodEnd + 3600);
    await expect.poll(allowanceCount, { timeout: 120_000 }).toBeGreaterThan(firstCount);
    await expect.poll(async () => (await stripe.customers.retrieve(customer.id) as Stripe.Customer).balance, { timeout: 60_000 }).toBe(0);

    // 5) Failed renewal → payment_failed email queued, then past due.
    const failing = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customer.id });
    await stripe.subscriptions.update(sub!.stripe_subscription_id!, { default_payment_method: failing.id });
    const nextEnd = (await stripe.subscriptions.retrieve(sub!.stripe_subscription_id!)).items.data[0]!.current_period_end;
    await advance(clock.id, nextEnd + 3600);
    await expect
      .poll(async () => (await admin.from("notifications_log").select("template_key").eq("household_id", householdId)).data?.map((n) => n.template_key) ?? [], { timeout: 120_000 })
      .toContain("payment_failed");
    await expect
      .poll(async () => (await admin.from("subscriptions").select("status").eq("id", sub!.id).single()).data?.status, { timeout: 120_000 })
      .toBe("past_due");
    await page.goto("/order");
    await expect(page.getByText(/last plan payment didn't go through/)).toBeVisible();
  } finally {
    await stripe.testHelpers.testClocks.del(clock.id).catch(() => undefined);
  }
});
