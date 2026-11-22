import "server-only";

import { stripeMockMode } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

import * as stripePay from "./stripe";
import * as stripeSubs from "./subscriptions";

/**
 * Payments behind one interface. Stripe (Phase 6) in development, staging
 * and production; a mock only when the environment has the placeholder
 * `sk_test_dummy` / `sk_test_ci_dummy` keys (CI has no Stripe access). Amounts
 * are never passed in: every implementation reads the order's server-computed
 * total itself (CLAUDE.md §5.8).
 */
export type OrderPaymentStep =
  { kind: "paid" } | { kind: "nothing_due" } | { kind: "client_secret"; clientSecret: string; amountCents: number };

export type ChangeStep =
  | { kind: "settled" }
  | { kind: "charged"; amountCents: number }
  | { kind: "refunded"; amountCents: number }
  | { kind: "client_secret"; clientSecret: string; amountCents: number };

export type SubscriptionStep =
  { kind: "active" } | { kind: "client_secret"; clientSecret: string; amountCents: number };

export interface PaymentProvider {
  readonly name: "mock" | "stripe";
  startOrderPayment(orderId: string): Promise<OrderPaymentStep>;
  settleOrderChange(orderId: string, requestedBy: string): Promise<ChangeStep>;
  executeRefund(refundId: string): Promise<void>;
  startSubscription(subscriptionId: string): Promise<SubscriptionStep>;
  applySkipCredit(subscriptionId: string, weekId: string, skip: boolean): Promise<number>;
  setPause(subscriptionId: string, until: Date | null): Promise<void>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
  changePlanOrQuantity(subscriptionId: string, opts: { planId?: string; quantity?: number }): Promise<void>;
  portalUrl(householdId: string, returnPath: string): Promise<string | null>;
  reconcile(orderId: string): Promise<void>;
}

const stripeProvider: PaymentProvider = {
  name: "stripe",
  async startOrderPayment(orderId) {
    const r = await stripePay.startOrderPayment(orderId);
    return r.status === "nothing_due"
      ? { kind: "nothing_due" }
      : { kind: "client_secret", clientSecret: r.clientSecret, amountCents: r.amountCents };
  },
  async settleOrderChange(orderId, requestedBy) {
    const r = await stripePay.settleOrderChange(orderId, requestedBy);
    if (r.status === "requires_action" || r.status === "requires_payment") {
      return { kind: "client_secret", clientSecret: r.clientSecret, amountCents: r.amountCents };
    }
    return r.status === "settled" ? { kind: "settled" } : { kind: r.status, amountCents: r.amountCents };
  },
  executeRefund: (id) => stripePay.executeRefund(id),
  async startSubscription(subscriptionId) {
    const r = await stripeSubs.startStripeSubscription(subscriptionId);
    return { kind: "client_secret", ...r };
  },
  applySkipCredit: stripeSubs.applySkipCredit,
  setPause: stripeSubs.setPause,
  setCancelAtPeriodEnd: stripeSubs.setCancelAtPeriodEnd,
  changePlanOrQuantity: stripeSubs.changePlanOrQuantity,
  portalUrl: stripeSubs.customerPortalUrl,
  reconcile: stripePay.reconcileOrderPayments,
};

const INTERVAL_DAYS = { week: 7, two_weeks: 14, month: 30 } as const;

/**
 * CI / placeholder-key mock. Plays the part of Stripe's webhook through the
 * same stripe_* SQL functions, so order and refund state moves exactly as it
 * would with real events. Service role: stands in for the webhook.
 */
const mockProvider: PaymentProvider = {
  name: "mock",
  async startOrderPayment(orderId) {
    const admin = createAdminClient();
    const { data: o } = await admin
      .from("orders")
      .select("status, total_cents, currency, amount_paid_cents, amount_refunded_cents, payment_version")
      .eq("id", orderId)
      .single();
    if (!o || o.status !== "pending_payment") return { kind: "nothing_due" };
    const due = o.total_cents - (o.amount_paid_cents - o.amount_refunded_cents);
    if (due <= 0) return { kind: "nothing_due" };
    const pi = `pi_mock_${orderId.replace(/-/g, "").slice(0, 12)}_v${o.payment_version}`;
    await admin.rpc("stripe_record_payment_intent", {
      p_order: orderId,
      p_payment_intent: pi,
      p_kind: o.amount_paid_cents > 0 ? "adjustment" : "charge",
      p_amount: due,
      p_currency: o.currency,
    });
    await admin.rpc("stripe_payment_succeeded", { p_payment_intent: pi, p_amount_received: due });
    return { kind: "paid" };
  },
  async settleOrderChange(orderId, requestedBy) {
    const admin = createAdminClient();
    const { data: o } = await admin
      .from("orders")
      .select("total_cents, amount_paid_cents, amount_refunded_cents")
      .eq("id", orderId)
      .single();
    if (!o) return { kind: "settled" };
    const due = o.total_cents - (o.amount_paid_cents - o.amount_refunded_cents);
    if (due === 0) return { kind: "settled" };
    if (due > 0) {
      if (o.amount_paid_cents === 0) return { kind: "settled" }; // never paid: the payment step handles it
      await this.startOrderPayment(orderId);
      return { kind: "charged", amountCents: due };
    }
    const { data: row } = await admin
      .from("order_refunds")
      .insert({
        order_id: orderId,
        amount_cents: -due,
        reason: "Order changed before cutoff",
        requested_by: requestedBy,
      })
      .select("id")
      .single();
    if (row) await this.executeRefund(row.id);
    return { kind: "refunded", amountCents: -due };
  },
  async executeRefund(refundId) {
    const admin = createAdminClient();
    const { data: r } = await admin.from("order_refunds").select("order_id, amount_cents").eq("id", refundId).single();
    if (!r) return;
    const { data: pays } = await admin
      .from("order_payments")
      .select("stripe_payment_intent_id, amount_cents, refunded_cents")
      .eq("order_id", r.order_id)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false });
    let left = r.amount_cents;
    for (const p of pays ?? []) {
      const take = Math.min(p.amount_cents - p.refunded_cents, left);
      if (take <= 0) continue;
      await admin.rpc("stripe_payment_refunded", {
        p_payment_intent: p.stripe_payment_intent_id,
        p_refunded_total: p.refunded_cents + take,
      });
      left -= take;
    }
    await admin.rpc("stripe_record_refund", {
      p_refund: refundId,
      p_stripe_refund: `re_mock_${refundId.slice(0, 8)}`,
      p_status: "succeeded",
      p_error: null,
    });
  },
  async startSubscription(subscriptionId) {
    const admin = createAdminClient();
    const { data: sub } = await admin
      .from("subscriptions")
      .select("id, status, plans!subscriptions_plan_id_fkey ( billing_interval )")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (!sub || sub.status !== "incomplete") throw new Error("This plan can't be started.");
    const interval = ((sub as unknown as { plans: { billing_interval: keyof typeof INTERVAL_DAYS } }).plans
      ?.billing_interval ?? "week") as keyof typeof INTERVAL_DAYS;
    const now = new Date();
    const end = new Date(now.getTime() + INTERVAL_DAYS[interval] * 86_400_000);
    await admin
      .from("subscriptions")
      .update({ stripe_subscription_id: `sub_mock_${subscriptionId.replace(/-/g, "").slice(0, 16)}` })
      .eq("id", subscriptionId);
    await admin.rpc("stripe_invoice_paid", {
      p_subscription: subscriptionId,
      p_stripe_subscription: null,
      p_period_start: now.toISOString(),
      p_period_end: end.toISOString(),
    });
    return { kind: "active" };
  },
  async applySkipCredit() {
    return 0;
  },
  async setPause() {},
  async setCancelAtPeriodEnd() {},
  async changePlanOrQuantity() {},
  async portalUrl() {
    return null;
  },
  async reconcile() {},
};

export function getPaymentProvider(): PaymentProvider {
  return stripeMockMode() ? mockProvider : stripeProvider;
}
