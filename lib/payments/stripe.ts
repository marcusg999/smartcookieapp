import "server-only";

import Stripe from "stripe";

import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe payments (Phase 6). Every amount is read from the database, never
 * from the caller (CLAUDE.md §5.8). Callers must have checked, with the
 * user's own RLS-scoped client, that the order or subscription is theirs.
 *
 * Service role in this module: households.stripe_customer_id, order_payments
 * and order_refunds are written only by the server (users can't write payment
 * state). Every write goes through a stripe_* SQL function or a single
 * column the server owns.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type PaymentStart =
  | { status: "nothing_due" }
  | { status: "requires_payment"; clientSecret: string; amountCents: number; paymentIntentId: string };

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

/** One Stripe Customer per household, created on first checkout. */
export async function ensureHouseholdCustomer(householdId: string, admin: Admin = createAdminClient()): Promise<string> {
  const hh = check(
    await admin.from("households").select("id, name, stripe_customer_id, primary_user_id").eq("id", householdId).single(),
  );
  if (hh.stripe_customer_id) return hh.stripe_customer_id as string;
  const { data: user } = await admin.auth.admin.getUserById(hh.primary_user_id as string);
  const customer = await stripe().customers.create(
    {
      name: hh.name as string,
      email: user?.user?.email ?? undefined,
      metadata: { household_id: householdId },
    },
    // Two tabs racing at first checkout still make one customer.
    { idempotencyKey: `customer:household:${householdId}` },
  );
  // Only set it if nobody else did in the meantime.
  await admin.from("households").update({ stripe_customer_id: customer.id }).eq("id", householdId).is("stripe_customer_id", null);
  const again = check(await admin.from("households").select("stripe_customer_id").eq("id", householdId).single());
  return again.stripe_customer_id as string;
}

/** What's still owed on an order: total minus collected (net of refunds). */
async function amountDue(admin: Admin, orderId: string) {
  const o = check(
    await admin
      .from("orders")
      .select(
        "id, order_number, household_id, status, total_cents, currency, amount_paid_cents, amount_refunded_cents, payment_version, tax_cents, delivery_fee_cents, subtotal_cents, discount_cents, address_snapshot",
      )
      .eq("id", orderId)
      .single(),
  );
  const due = (o.total_cents as number) - ((o.amount_paid_cents as number) - (o.amount_refunded_cents as number));
  return { order: o, due };
}

/**
 * Stripe Tax (optional, owner setting, default off): calculate tax for an
 * unpaid order from its delivery address and record it before charging.
 */
async function applyStripeTax(admin: Admin, orderId: string) {
  const { data: settings } = await admin.from("site_settings").select("tax_settings").eq("id", true).single();
  const tax = (settings?.tax_settings ?? {}) as { enabled?: boolean; use_stripe_tax?: boolean };
  if (!tax.enabled || !tax.use_stripe_tax) return;
  const { order } = await amountDue(admin, orderId);
  const addr = order.address_snapshot as { line1: string; city: string; state: string; zip: string } | null;
  if (!addr || (order.amount_paid_cents as number) > 0) return;
  const calc = await stripe().tax.calculations.create({
    currency: order.currency as string,
    customer_details: {
      address: { line1: addr.line1, city: addr.city, state: addr.state, postal_code: addr.zip, country: "US" },
      address_source: "shipping",
    },
    line_items: [
      {
        amount: Math.max((order.subtotal_cents as number) - (order.discount_cents as number), 0),
        reference: `order:${order.id}`,
        tax_behavior: "exclusive",
      },
    ],
    shipping_cost: { amount: order.delivery_fee_cents as number },
  });
  check(await admin.rpc("stripe_set_order_tax", { p_order: orderId, p_tax: calc.tax_amount_exclusive }));
}

/**
 * Start (or resume) paying for an order: a PaymentIntent for exactly what's
 * due, saved for off-session use so a later change can be charged without the
 * family re-entering a card. Idempotency key = order + payment version + amount,
 * so a retry never creates a second charge for the same version.
 */
export async function startOrderPayment(orderId: string): Promise<PaymentStart> {
  const admin = createAdminClient();
  await applyStripeTax(admin, orderId);
  const { order, due } = await amountDue(admin, orderId);
  if (due <= 0 || order.status !== "pending_payment") return { status: "nothing_due" };

  // Re-use an open intent for this order if it's for the same amount.
  const { data: open } = await admin
    .from("order_payments")
    .select("stripe_payment_intent_id, amount_cents")
    .eq("order_id", orderId)
    .in("status", ["requires_payment", "requires_action", "failed"])
    .order("created_at", { ascending: false });
  for (const p of open ?? []) {
    const pi = await stripe().paymentIntents.retrieve(p.stripe_payment_intent_id as string);
    const reusable = ["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status);
    if (reusable && pi.amount === due && pi.client_secret) {
      return { status: "requires_payment", clientSecret: pi.client_secret, amountCents: due, paymentIntentId: pi.id };
    }
    if (reusable) await stripe().paymentIntents.cancel(pi.id).catch(() => undefined);
  }

  const customer = await ensureHouseholdCustomer(order.household_id as string, admin);
  const kind = (order.amount_paid_cents as number) > 0 ? "adjustment" : "charge";
  const pi = await stripe().paymentIntents.create(
    {
      amount: due,
      currency: order.currency as string,
      customer,
      // Dynamic payment methods (cards, Link, Apple Pay, Google Pay) come from
      // Dashboard settings; payment_method_types is no longer a parameter.
      automatic_payment_methods: { enabled: true },
      setup_future_usage: "off_session",
      description: `Smart Cookie order ${order.order_number}`,
      metadata: {
        order_id: order.id as string,
        order_number: order.order_number as string,
        household_id: order.household_id as string,
        payment_version: String(order.payment_version),
        kind,
      },
    },
    { idempotencyKey: `order:${order.id}:v${order.payment_version}:${kind}:${due}` },
  );
  check(
    await admin.rpc("stripe_record_payment_intent", {
      p_order: orderId,
      p_payment_intent: pi.id,
      p_kind: kind,
      p_amount: due,
      p_currency: order.currency as string,
    }),
  );
  return { status: "requires_payment", clientSecret: pi.client_secret!, amountCents: due, paymentIntentId: pi.id };
}

export type ChangeSettlement =
  | { status: "settled" }
  | { status: "charged"; amountCents: number }
  | { status: "refunded"; amountCents: number }
  | { status: "requires_action"; clientSecret: string; amountCents: number }
  | { status: "requires_payment"; clientSecret: string; amountCents: number };

/**
 * After a family changes an order before cutoff (Phase 5 re-prices it):
 * more owed → charge the difference off-session with the saved card, falling
 * back to an on-session prompt (3DS or no saved card); less owed → partial
 * refund of the difference.
 */
export async function settleOrderChange(orderId: string, requestedBy: string): Promise<ChangeSettlement> {
  const admin = createAdminClient();
  const { order, due } = await amountDue(admin, orderId);
  if (due === 0) return { status: "settled" };

  if (due < 0) {
    const amount = -due;
    const row = check(
      await admin
        .from("order_refunds")
        .insert({ order_id: orderId, amount_cents: amount, reason: "Order changed before cutoff", requested_by: requestedBy })
        .select("id")
        .single(),
    );
    await executeRefund(row.id as string, admin);
    return { status: "refunded", amountCents: amount };
  }

  if ((order.amount_paid_cents as number) === 0) {
    const start = await startOrderPayment(orderId);
    return start.status === "requires_payment"
      ? { status: "requires_payment", clientSecret: start.clientSecret, amountCents: start.amountCents }
      : { status: "settled" };
  }

  // Off-session top-up with the card used for this order.
  const { data: paid } = await admin
    .from("order_payments")
    .select("stripe_payment_intent_id")
    .eq("order_id", orderId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = paid ? await stripe().paymentIntents.retrieve(paid.stripe_payment_intent_id as string) : null;
  const paymentMethod = typeof previous?.payment_method === "string" ? previous.payment_method : previous?.payment_method?.id;
  const customer = await ensureHouseholdCustomer(order.household_id as string, admin);
  if (!paymentMethod) {
    const start = await startOrderPayment(orderId);
    return start.status === "requires_payment"
      ? { status: "requires_payment", clientSecret: start.clientSecret, amountCents: start.amountCents }
      : { status: "settled" };
  }
  const idempotencyKey = `order:${order.id}:v${order.payment_version}:adjustment:${due}`;
  const metadata = {
    order_id: order.id as string,
    order_number: order.order_number as string,
    household_id: order.household_id as string,
    payment_version: String(order.payment_version),
    kind: "adjustment",
  };
  try {
    const pi = await stripe().paymentIntents.create(
      {
        amount: due,
        currency: order.currency as string,
        customer,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: `Smart Cookie order ${order.order_number} (change)`,
        metadata,
      },
      { idempotencyKey },
    );
    check(
      await admin.rpc("stripe_record_payment_intent", {
        p_order: orderId,
        p_payment_intent: pi.id,
        p_kind: "adjustment",
        p_amount: due,
        p_currency: order.currency as string,
      }),
    );
    // The webhook marks it succeeded; reflect it now too so the page is right.
    if (pi.status === "succeeded") {
      await admin.rpc("stripe_payment_succeeded", { p_payment_intent: pi.id, p_amount_received: pi.amount_received });
    }
    return { status: "charged", amountCents: due };
  } catch (error) {
    // Card needs the customer present (3DS) or was declined: prompt on-session.
    const err = error as Stripe.errors.StripeError & { payment_intent?: Stripe.PaymentIntent };
    const pi = err.payment_intent;
    if (pi?.id && pi.client_secret) {
      check(
        await admin.rpc("stripe_record_payment_intent", {
          p_order: orderId,
          p_payment_intent: pi.id,
          p_kind: "adjustment",
          p_amount: due,
          p_currency: order.currency as string,
        }),
      );
      await admin.rpc("stripe_payment_failed", {
        p_payment_intent: pi.id,
        p_error: err.code ?? err.message,
        p_requires_action: err.code === "authentication_required",
      });
      return { status: "requires_action", clientSecret: pi.client_secret, amountCents: due };
    }
    throw error;
  }
}

/**
 * Send a pending order_refunds row to Stripe, taking it from the order's
 * succeeded payments (newest first). A refund that spans two payments is
 * split into two rows. Idempotent per row + intent.
 */
export async function executeRefund(refundId: string, admin: Admin = createAdminClient()): Promise<void> {
  const refund = check(
    await admin.from("order_refunds").select("id, order_id, amount_cents, reason, requested_by, status").eq("id", refundId).single(),
  );
  if (refund.status !== "pending") return;
  const { data: payments } = await admin
    .from("order_payments")
    .select("stripe_payment_intent_id, amount_cents, refunded_cents")
    .eq("order_id", refund.order_id)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false });
  let remaining = refund.amount_cents as number;
  let first = true;
  for (const p of payments ?? []) {
    const available = (p.amount_cents as number) - (p.refunded_cents as number);
    if (available <= 0 || remaining <= 0) continue;
    const amount = Math.min(available, remaining);
    let rowId = refund.id as string;
    if (!first) {
      const extra = check(
        await admin
          .from("order_refunds")
          .insert({ order_id: refund.order_id, amount_cents: amount, reason: refund.reason, requested_by: refund.requested_by })
          .select("id")
          .single(),
      );
      rowId = extra.id as string;
    } else if (amount !== refund.amount_cents) {
      await admin.from("order_refunds").update({ amount_cents: amount }).eq("id", rowId);
    }
    try {
      const r = await stripe().refunds.create(
        {
          payment_intent: p.stripe_payment_intent_id as string,
          amount,
          reason: "requested_by_customer",
          metadata: { order_id: refund.order_id as string, refund_row: rowId, note: (refund.reason as string).slice(0, 200) },
        },
        { idempotencyKey: `refund:${rowId}:${p.stripe_payment_intent_id}` },
      );
      await admin.rpc("stripe_record_refund", {
        p_refund: rowId,
        p_stripe_refund: r.id,
        p_status: r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : "pending",
        p_error: null,
      });
      if (r.status === "succeeded") {
        const charge = await stripe().paymentIntents.retrieve(p.stripe_payment_intent_id as string, { expand: ["latest_charge"] });
        const refunded = typeof charge.latest_charge === "object" && charge.latest_charge ? charge.latest_charge.amount_refunded : 0;
        await admin.rpc("stripe_payment_refunded", { p_payment_intent: charge.id, p_refunded_total: refunded });
      }
    } catch (error) {
      await admin.rpc("stripe_record_refund", {
        p_refund: rowId,
        p_stripe_refund: null,
        p_status: "failed",
        p_error: (error as Error).message,
      });
      throw error;
    }
    remaining -= amount;
    first = false;
  }
}

/**
 * Read the order's open PaymentIntents back from Stripe and apply what Stripe
 * says (server to Stripe, never trusting the browser). The webhook normally
 * gets there first; this keeps the processing screen honest when it's slow.
 */
export async function reconcileOrderPayments(orderId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: open } = await admin
    .from("order_payments")
    .select("stripe_payment_intent_id")
    .eq("order_id", orderId)
    .in("status", ["requires_payment", "requires_action", "processing"]);
  for (const p of open ?? []) {
    const pi = await stripe().paymentIntents.retrieve(p.stripe_payment_intent_id as string);
    if (pi.status === "succeeded") {
      await admin.rpc("stripe_payment_succeeded", { p_payment_intent: pi.id, p_amount_received: pi.amount_received });
    } else if (pi.status === "requires_payment_method" && pi.last_payment_error) {
      await admin.rpc("stripe_payment_failed", {
        p_payment_intent: pi.id,
        p_error: pi.last_payment_error.message ?? pi.last_payment_error.code ?? "Payment failed",
        p_requires_action: false,
      });
    }
  }
}
