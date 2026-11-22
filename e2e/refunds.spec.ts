import { randomUUID } from "node:crypto";

import Stripe from "stripe";

import { expect, signInWithPassword, test } from "./support/fixtures";
import { admin, createUser, enrollTotp, uniqueEmail } from "./support/supabase";
import { freshTotp } from "./support/totp";

import type { Page } from "@playwright/test";

// Phase 6 admin refunds: step-up, the ops per-refund limit, and the result in
// the order (and in Stripe, when running against real test mode).
test.skip(({ isMobile }) => isMobile, "admin flows run once, on desktop");
test.describe.configure({ mode: "parallel" });

const MOCK = /^(sk|rk)_test_(ci_)?dummy$/.test(process.env.STRIPE_SECRET_KEY ?? "");
const stripe = MOCK
  ? null
  : new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-11-18.endive",
      httpClient: Stripe.createFetchHttpClient(),
    });

/** A paid $20 order. Real mode: a real succeeded PaymentIntent (test card). */
async function paidOrder() {
  const userId = await createUser(uniqueEmail("refundee"));
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const { data: week } = await admin.from("menu_weeks").select("id").eq("status", "published").limit(1).single();
  const { data: order } = await admin
    .from("orders")
    .insert({
      household_id: hm!.household_id,
      menu_week_id: week!.id,
      status: "pending_payment",
      subtotal_cents: 2000,
      total_cents: 2000,
      placed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  let pi = `pi_mock_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  if (stripe) {
    const intent = await stripe.paymentIntents.create({
      amount: 2000,
      currency: "usd",
      payment_method: "pm_card_visa",
      confirm: true,
      allowed_payment_method_types: ["card"],
      metadata: { order_id: order!.id, e2e: "refunds" },
    });
    pi = intent.id;
  }
  await admin.rpc("stripe_record_payment_intent", {
    p_order: order!.id,
    p_payment_intent: pi,
    p_kind: "charge",
    p_amount: 2000,
    p_currency: "usd",
  });
  await admin.rpc("stripe_payment_succeeded", { p_payment_intent: pi, p_amount_received: 2000 });
  return { orderId: order!.id as string, pi };
}

async function signInStaff(page: Page, role: string) {
  const email = uniqueEmail(role);
  await createUser(email, [role]);
  const secret = await enrollTotp(email);
  await signInWithPassword(page, email);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  return secret;
}

async function refund(page: Page, secret: string, dollars: string, reason: string) {
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("…or an amount ($)").fill(dollars);
  await page.getByLabel("Reason").fill(reason);
  await page.getByRole("button", { name: /^Refund \$/ }).click();
  const stepUp = page.getByRole("dialog", { name: "Confirm it's you" });
  if (await stepUp.isVisible({ timeout: 3000 }).catch(() => false)) {
    await stepUp.getByLabel("6-digit code").fill(await freshTotp(secret));
    await stepUp.getByRole("button", { name: "Verify", exact: true }).click();
  }
}

test("ops refunds part of an order within their limit; it shows on the order and in Stripe", async ({ page }) => {
  test.slow();
  const { orderId, pi } = await paidOrder();
  const secret = await signInStaff(page, "ops");
  await page.goto(`/admin/orders/${orderId}`);
  await refund(page, secret, "5", "One meal arrived cold");
  await expect(page.getByText("Refunded $5.00.")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (await admin.from("orders").select("amount_refunded_cents").eq("id", orderId).single()).data
          ?.amount_refunded_cents,
      { timeout: 30_000 },
    )
    .toBe(500);
  if (stripe) {
    const refunds = await stripe.refunds.list({ payment_intent: pi });
    expect(refunds.data.map((r) => r.amount)).toContain(500);
  }
});

test("ops can't refund more than their limit", async ({ page }) => {
  test.slow();
  await admin.from("site_settings").update({ ops_refund_limit_cents: 1000 }).eq("id", true);
  try {
    const { orderId } = await paidOrder();
    const secret = await signInStaff(page, "ops");
    await page.goto(`/admin/orders/${orderId}`);
    await refund(page, secret, "15", "Over the limit");
    await expect(page.getByText(/over your refund limit/i)).toBeVisible({ timeout: 30_000 });
    const { data } = await admin.from("orders").select("amount_refunded_cents").eq("id", orderId).single();
    expect(data!.amount_refunded_cents).toBe(0);
  } finally {
    await admin.from("site_settings").update({ ops_refund_limit_cents: 5000 }).eq("id", true);
  }
});
