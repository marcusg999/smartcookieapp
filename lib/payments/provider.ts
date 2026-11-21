import "server-only";

import { stripeMockMode } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Payments sit behind this interface so checkout can be built and tested now
 * and Stripe (Payment Element with Link, Billing) slots in for Phase 6 without
 * touching the screens. Amounts are NEVER passed in: a provider reads the
 * order's server-computed total itself (CLAUDE.md §5.8).
 */
export interface PaymentProvider {
  readonly name: "mock" | "stripe";
  /** Take payment for an order in `pending_payment`. */
  payOrder(orderId: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Start a plan for an `incomplete` subscription. */
  startSubscription(subscriptionId: string): Promise<{ ok: true } | { ok: false; message: string }>;
}

const INTERVAL_DAYS = { week: 7, two_weeks: 14, month: 30 } as const;

/**
 * Local / CI only (Stripe in mock mode, `sk_test_dummy`). Plays the part of
 * Stripe's webhook: marks the order paid / the subscription active.
 */
const mockProvider: PaymentProvider = {
  name: "mock",
  async payOrder(orderId) {
    // Service role: stands in for the Stripe webhook, which is the only
    // writer of payment status (families can't set their own order to paid).
    // The caller has already checked, with RLS, that the order is theirs.
    const { data, error } = await createAdminClient()
      .from("orders")
      .update({ status: "paid", stripe_payment_intent_id: `pi_mock_${orderId.replace(/-/g, "").slice(0, 16)}` })
      .eq("id", orderId)
      .eq("status", "pending_payment")
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, message: "This order isn't waiting for payment." };
    return { ok: true };
  },
  async startSubscription(subscriptionId) {
    // Service role: stands in for the Stripe webhook (subscriptions are
    // written only by the webhook). The caller checked ownership with RLS.
    const admin = createAdminClient();
    const { data: sub } = await admin
      .from("subscriptions")
      .select("id, status, plans ( billing_interval )")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (!sub || sub.status !== "incomplete") return { ok: false, message: "This plan can't be started." };
    const interval = ((sub as unknown as { plans: { billing_interval: keyof typeof INTERVAL_DAYS } }).plans?.billing_interval ??
      "week") as keyof typeof INTERVAL_DAYS;
    const now = new Date();
    const { error } = await admin
      .from("subscriptions")
      .update({
        status: "active",
        stripe_subscription_id: `sub_mock_${subscriptionId.replace(/-/g, "").slice(0, 16)}`,
        current_period_start: now.toISOString(),
        current_period_end: new Date(now.getTime() + INTERVAL_DAYS[interval] * 86_400_000).toISOString(),
      })
      .eq("id", subscriptionId);
    return error ? { ok: false, message: "We couldn't start your plan." } : { ok: true };
  },
};

/** Phase 6 replaces this with the Stripe implementation. */
const unavailableProvider: PaymentProvider = {
  name: "stripe",
  async payOrder() {
    return { ok: false, message: "Online payment is coming soon. We'll be in touch to arrange payment." };
  },
  async startSubscription() {
    return { ok: false, message: "Plans can be started online soon. We'll be in touch." };
  },
};

export function getPaymentProvider(): PaymentProvider {
  return stripeMockMode() ? mockProvider : unavailableProvider;
}
