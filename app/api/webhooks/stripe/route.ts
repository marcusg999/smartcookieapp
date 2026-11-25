import { NextResponse } from "next/server";
import Stripe from "stripe";

import { env } from "@/lib/env";
import { executeRefund } from "@/lib/payments/stripe";
import { getPaymentProvider } from "@/lib/payments/provider";
import { handleStripeEvent } from "@/lib/payments/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Signature verification needs no network call; one shared instance is fine.
const verifier = new Stripe(env.STRIPE_SECRET_KEY);

/**
 * Stripe webhooks: the source of truth for payment state (CLAUDE.md §5.8).
 * 1. Verify the signature against the RAW body; reject anything else (400).
 * 2. Record event.id first and claim it; a replayed event is a 200 no-op.
 * 3. Apply it (each change is one SQL transaction), then mark it processed.
 * A failure returns 500 so Stripe retries; the claim lets the retry run.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing signature");
    event = verifier.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Service role: webhooks have no user session; Stripe's signature (verified
  // above) is the authentication, and only stripe_* functions are called.
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("stripe_claim_event", {
    p_event_id: event.id,
    p_type: event.type,
    p_livemode: event.livemode,
    p_payload: event as unknown as Record<string, unknown>,
  });
  if (claimError) return NextResponse.json({ error: "Storage unavailable" }, { status: 500 });
  if (!claimed) return NextResponse.json({ received: true, duplicate: true });

  try {
    const outcome = await handleStripeEvent(event, {
      admin,
      async refundInFull(orderId, reason) {
        const { data: o } = await admin
          .from("orders")
          .select("amount_paid_cents, amount_refunded_cents, households ( primary_user_id )")
          .eq("id", orderId)
          .single();
        const net = (o?.amount_paid_cents ?? 0) - (o?.amount_refunded_cents ?? 0);
        const requestedBy = (o as unknown as { households: { primary_user_id: string } | null })?.households
          ?.primary_user_id;
        if (net <= 0 || !requestedBy) return;
        const { data: row } = await admin
          .from("order_refunds")
          .insert({ order_id: orderId, amount_cents: net, reason, requested_by: requestedBy })
          .select("id")
          .single();
        if (!row) return;
        if (getPaymentProvider().name === "stripe") await executeRefund(row.id as string, admin);
        else await getPaymentProvider().executeRefund(row.id as string);
      },
    });
    await admin.rpc("stripe_finish_event", { p_event_id: event.id, p_error: null });
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    await admin.rpc("stripe_finish_event", { p_event_id: event.id, p_error: (error as Error).message });
    console.error("stripe webhook failed", { type: event.type, id: event.id });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
