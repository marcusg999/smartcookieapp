import "server-only";

import { stripe, stripeMockMode } from "@/lib/stripe/server";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type PaymentHealth = {
  /** Orders still "pending payment" well after they should have expired. */
  stuckOrders: string[];
  /** Orders whose Stripe payment succeeded but the order isn't paid (a missed webhook). */
  stripeMismatches: string[];
  /** Stripe events that failed to process and haven't been retried successfully. */
  failedWebhooks: number;
};

/**
 * Daily payment health check (Phase 10 monitoring). Finds orders stuck in
 * pending_payment, Stripe/DB mismatches and failed webhook events, and
 * emails the owner when anything turns up (once a day).
 */
export async function checkPaymentHealth(admin: Admin, now = new Date()): Promise<PaymentHealth> {
  const hourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
  const { data: stuck } = await admin
    .from("orders")
    .select("id, order_number, stripe_payment_intent_id")
    .eq("status", "pending_payment")
    .lt("expires_at", hourAgo)
    .limit(200);
  const { data: pending } = await admin
    .from("orders")
    .select("id, order_number, stripe_payment_intent_id")
    .eq("status", "pending_payment")
    .not("stripe_payment_intent_id", "is", null)
    .lt("updated_at", new Date(now.getTime() - 30 * 60_000).toISOString())
    .limit(50);
  const mismatches: string[] = [];
  if (!stripeMockMode()) {
    for (const o of pending ?? []) {
      try {
        const pi = await stripe().paymentIntents.retrieve(o.stripe_payment_intent_id as string);
        if (pi.status === "succeeded") mismatches.push(o.order_number as string);
      } catch {
        // A lookup failure isn't a mismatch; tomorrow's run tries again.
      }
    }
  }
  const { count: failed } = await admin
    .from("stripe_events")
    .select("event_id", { count: "exact", head: true })
    .not("error", "is", null)
    .is("processed_at", null)
    .lt("received_at", hourAgo);
  const health: PaymentHealth = {
    stuckOrders: (stuck ?? []).map((o) => o.order_number as string),
    stripeMismatches: mismatches,
    failedWebhooks: failed ?? 0,
  };
  if (health.stuckOrders.length || health.stripeMismatches.length || health.failedWebhooks) {
    const { data: s } = await admin.from("site_settings").select("contact_email").eq("id", true).single();
    if (s?.contact_email) {
      await admin.rpc("queue_email", {
        p_template: "owner_payment_health",
        p_to: s.contact_email,
        p_payload: {
          stuck_orders: health.stuckOrders.slice(0, 20).join(", ") || "none",
          stripe_mismatches: health.stripeMismatches.slice(0, 20).join(", ") || "none",
          failed_webhooks: health.failedWebhooks,
        },
        p_dedupe: `payment_health:${now.toISOString().slice(0, 10)}`,
        p_household: null,
        p_org: null,
        p_user: null,
      });
    }
  }
  return health;
}
