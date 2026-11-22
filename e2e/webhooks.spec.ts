import { randomUUID } from "node:crypto";

import Stripe from "stripe";

import { expect, test } from "./support/fixtures";
import { admin, createUser, uniqueEmail } from "./support/supabase";

import type { APIRequestContext } from "@playwright/test";

// Phase 6 webhooks. Events are signed with the app's webhook secret, so these
// run anywhere (CI has no Stripe access). Desktop project only: they're API tests.
test.skip(({ isMobile }) => isMobile, "API tests run once");
test.describe.configure({ mode: "parallel" });

const signer = new Stripe("sk_test_signing_only");
const secret = process.env.STRIPE_WEBHOOK_SECRET!;

async function deliver(
  request: APIRequestContext,
  event: Record<string, unknown>,
  opts: { badSignature?: boolean } = {},
) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({
    payload,
    secret: opts.badSignature ? "whsec_wrong" : secret,
  });
  return request.post("/api/webhooks/stripe", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": header },
  });
}

const evt = (type: string, object: Record<string, unknown>, created = Math.floor(Date.now() / 1000)) => ({
  id: `evt_test_${randomUUID().replace(/-/g, "")}`,
  object: "event",
  api_version: "2026-11-18.endive",
  created,
  livemode: false,
  type,
  data: { object },
});

/** A household with a pending order whose PaymentIntent is recorded. */
async function pendingOrder() {
  const userId = await createUser(uniqueEmail("wh"));
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
  const pi = `pi_test_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await admin.rpc("stripe_record_payment_intent", {
    p_order: order!.id,
    p_payment_intent: pi,
    p_kind: "charge",
    p_amount: 2000,
    p_currency: "usd",
  });
  return { orderId: order!.id as string, pi, householdId: hm!.household_id as string };
}

test("a bad signature is rejected with 400", async ({ request }) => {
  const res = await deliver(request, evt("payment_intent.succeeded", { id: "pi_x", amount_received: 1 }), {
    badSignature: true,
  });
  expect(res.status()).toBe(400);
});

test("payment_intent.succeeded marks the order paid, and a replayed event is ignored", async ({ request }) => {
  const { orderId, pi } = await pendingOrder();
  const event = evt("payment_intent.succeeded", {
    id: pi,
    object: "payment_intent",
    amount_received: 2000,
    metadata: { order_id: orderId },
  });
  const first = await deliver(request, event);
  expect(first.status()).toBe(200);
  expect((await first.json()).outcome).toBe("paid");
  const replay = await deliver(request, event);
  expect(await replay.json()).toMatchObject({ duplicate: true });
  const { data: o } = await admin.from("orders").select("status, amount_paid_cents").eq("id", orderId).single();
  expect(o).toEqual({ status: "paid", amount_paid_cents: 2000 }); // not counted twice
});

test("payment_intent.payment_failed records the error; charge.refunded marks it refunded", async ({ request }) => {
  const { orderId, pi } = await pendingOrder();
  await deliver(
    request,
    evt("payment_intent.payment_failed", { id: pi, last_payment_error: { message: "Your card was declined." } }),
  );
  let { data: o } = await admin.from("orders").select("last_payment_error, status").eq("id", orderId).single();
  expect(o).toMatchObject({ last_payment_error: "Your card was declined.", status: "pending_payment" });
  await deliver(
    request,
    evt("payment_intent.succeeded", { id: pi, amount_received: 2000, metadata: { order_id: orderId } }),
  );
  await deliver(request, evt("charge.refunded", { id: "ch_x", payment_intent: pi, amount_refunded: 2000 }));
  ({ data: o } = await admin.from("orders").select("last_payment_error, status").eq("id", orderId).single());
  expect(o!.status).toBe("refunded");
});

test("out of order: invoice.paid before subscription.created still creates allowances, and stale updates are ignored", async ({
  request,
}) => {
  const userId = await createUser(uniqueEmail("whsub"));
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const { data: plan } = await admin.from("plans").select("id").eq("slug", "3-lunches-week").single();
  const { data: sub } = await admin
    .from("subscriptions")
    .insert({ household_id: hm!.household_id, plan_id: plan!.id, status: "incomplete" })
    .select("id")
    .single();
  const stripeSub = `sub_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const { data: weeks } = await admin.from("menu_weeks").select("id, week_start").order("week_start").limit(2);
  const start = Math.floor(Date.parse(`${weeks![0]!.week_start}T12:00:00Z`) / 1000) - 86400;
  const end = start + 14 * 86400;

  // 1) invoice.paid arrives first (the subscription row has no Stripe id yet).
  const paid = await deliver(
    request,
    evt("invoice.paid", {
      id: `in_test_${randomUUID().slice(0, 8)}`,
      object: "invoice",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: stripeSub, metadata: { subscription_id: sub!.id } },
      },
      lines: { data: [{ period: { start, end } }] },
    }),
  );
  expect((await paid.json()).outcome).toBe("allowances");
  const { data: s1 } = await admin
    .from("subscriptions")
    .select("status, stripe_subscription_id")
    .eq("id", sub!.id)
    .single();
  expect(s1).toEqual({ status: "active", stripe_subscription_id: stripeSub });
  const { count } = await admin
    .from("subscription_allowances")
    .select("id", { count: "exact", head: true })
    .eq("subscription_id", sub!.id);
  expect(count).toBeGreaterThanOrEqual(1);

  // 2) A newer update (cancel at period end), then an OLDER created event: the older one must not roll it back.
  const now = Math.floor(Date.now() / 1000);
  const object = (cancel: boolean) => ({
    id: stripeSub,
    object: "subscription",
    status: "active",
    cancel_at_period_end: cancel,
    pause_collection: null,
    metadata: { subscription_id: sub!.id },
    items: {
      data: [{ quantity: 2, current_period_start: start, current_period_end: end, price: { id: "price_unknown" } }],
    },
  });
  await deliver(request, evt("customer.subscription.updated", object(true), now));
  await deliver(request, evt("customer.subscription.created", object(false), now - 60));
  const { data: s2 } = await admin
    .from("subscriptions")
    .select("cancel_at_period_end, quantity")
    .eq("id", sub!.id)
    .single();
  expect(s2).toEqual({ cancel_at_period_end: true, quantity: 2 });
});

test("invoice.payment_failed queues the update-your-card email", async ({ request }) => {
  const userId = await createUser(uniqueEmail("dun"));
  const { data: hm } = await admin.from("household_members").select("household_id").eq("user_id", userId).single();
  const { data: plan } = await admin.from("plans").select("id").eq("slug", "3-lunches-week").single();
  const { data: sub } = await admin
    .from("subscriptions")
    .insert({ household_id: hm!.household_id, plan_id: plan!.id, status: "active" })
    .select("id")
    .single();
  await deliver(
    request,
    evt("invoice.payment_failed", {
      id: "in_fail",
      object: "invoice",
      attempt_count: 1,
      next_payment_attempt: Math.floor(Date.now() / 1000) + 86400,
      parent: { subscription_details: { subscription: null, metadata: { subscription_id: sub!.id } } },
      lines: { data: [] },
    }),
  );
  const { data: n } = await admin.from("notifications_log").select("template_key").eq("household_id", hm!.household_id);
  expect(n?.map((x) => x.template_key)).toContain("payment_failed");
});
