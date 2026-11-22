import "server-only";

import { env } from "@/lib/env";
import { createPrice, ensureProduct, planRecurring, stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { ensureHouseholdCustomer } from "./stripe";

/**
 * Stripe Billing for family plans (Phase 6). Service role in this module:
 * subscriptions are written only by the server and the webhook; callers have
 * already checked with the parent's RLS-scoped client that the subscription
 * belongs to their household, and the DB functions enforced the plan rules.
 */

type Admin = ReturnType<typeof createAdminClient>;

function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

/** Make sure a plan has a real Stripe Price (seed/mock plans get one on first use). */
export async function ensurePlanPrice(planId: string, admin: Admin = createAdminClient()): Promise<string> {
  const plan = must(
    await admin
      .from("plans")
      .select("id, name, slug, price_cents, currency, billing_interval, stripe_product_id, stripe_price_id")
      .eq("id", planId)
      .single(),
  );
  const real = (id: unknown) => typeof id === "string" && id.length > 0 && !id.includes("_mock_");
  if (real(plan.stripe_price_id)) return plan.stripe_price_id as string;
  const productId = real(plan.stripe_product_id)
    ? (plan.stripe_product_id as string)
    : await ensureProduct({ name: plan.name as string, metadata: { plan_id: plan.id as string, kind: "plan" } });
  const priceId = await createPrice({
    productId,
    unitAmount: plan.price_cents as number,
    currency: plan.currency as string,
    recurring: planRecurring(plan.billing_interval as "week" | "two_weeks" | "month"),
    metadata: { plan_id: plan.id as string },
  });
  // Trusted writer (service role) bypasses the price guard: this only attaches
  // Stripe ids for the price the owner already set; the amount is unchanged.
  must(await admin.from("plans").update({ stripe_product_id: productId, stripe_price_id: priceId }).eq("id", planId));
  return priceId;
}

/** Children the plan pays for: per-child plans bill one unit per active child. */
async function quantityFor(admin: Admin, householdId: string, allowanceUnit: string): Promise<number> {
  if (allowanceUnit !== "per_child") return 1;
  const { count } = await admin
    .from("children")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .is("archived_at", null);
  return Math.max(count ?? 1, 1);
}

/**
 * Create the Stripe subscription for an `incomplete` row and return the
 * client secret the Payment Element confirms (first invoice). Webhooks then
 * activate it (invoice.paid) and create the week allowances.
 */
export async function startStripeSubscription(subscriptionId: string): Promise<{ clientSecret: string; amountCents: number }> {
  const admin = createAdminClient();
  const sub = must(
    await admin
      .from("subscriptions")
      .select("id, household_id, plan_id, status, stripe_subscription_id, plans ( allowance_unit, price_cents )")
      .eq("id", subscriptionId)
      .single(),
  ) as unknown as {
    id: string;
    household_id: string;
    plan_id: string;
    status: string;
    stripe_subscription_id: string | null;
    plans: { allowance_unit: string; price_cents: number };
  };
  if (sub.status !== "incomplete") throw new Error("This plan has already been started.");
  const [customer, price, quantity, settings] = await Promise.all([
    ensureHouseholdCustomer(sub.household_id, admin),
    ensurePlanPrice(sub.plan_id, admin),
    quantityFor(admin, sub.household_id, sub.plans.allowance_unit),
    admin.from("site_settings").select("tax_settings").eq("id", true).single(),
  ]);
  const tax = (settings.data?.tax_settings ?? {}) as { enabled?: boolean; use_stripe_tax?: boolean };

  const stripeSub = sub.stripe_subscription_id
    ? await stripe().subscriptions.retrieve(sub.stripe_subscription_id, { expand: ["latest_invoice.confirmation_secret"] })
    : await stripe().subscriptions.create(
        {
          customer,
          items: [{ price, quantity }],
          payment_behavior: "default_incomplete",
          payment_settings: { save_default_payment_method: "on_subscription" },
          expand: ["latest_invoice.confirmation_secret"],
          // Read back by the webhook (also copied onto invoices), so events
          // that arrive before our row has the Stripe id still find it.
          metadata: { subscription_id: sub.id, household_id: sub.household_id },
          ...(tax.enabled && tax.use_stripe_tax ? { automatic_tax: { enabled: true } } : {}),
        },
        { idempotencyKey: `subscription:${sub.id}` },
      );
  must(
    await admin
      .from("subscriptions")
      .update({ stripe_subscription_id: stripeSub.id, quantity })
      .eq("id", sub.id),
  );
  const invoice = stripeSub.latest_invoice;
  const secret = typeof invoice === "object" && invoice ? invoice.confirmation_secret?.client_secret : null;
  if (!secret) throw new Error("Stripe didn't return a payment step for this plan.");
  return { clientSecret: secret, amountCents: typeof invoice === "object" && invoice ? invoice.amount_due : sub.plans.price_cents * quantity };
}

async function stripeSubscriptionFor(admin: Admin, subscriptionId: string) {
  const sub = must(
    await admin
      .from("subscriptions")
      .select("id, household_id, stripe_subscription_id, quantity, plans ( price_cents, currency, billing_interval, allowance_unit )")
      .eq("id", subscriptionId)
      .single(),
  ) as unknown as {
    id: string;
    household_id: string;
    stripe_subscription_id: string | null;
    quantity: number;
    plans: { price_cents: number; currency: string; billing_interval: "week" | "two_weeks" | "month"; allowance_unit: string };
  };
  if (!sub.stripe_subscription_id) throw new Error("This plan isn't connected to Stripe yet.");
  return sub;
}

/** One week's worth of the plan's price (what a skipped week is worth). */
export function weeklyValueCents(priceCents: number, quantity: number, interval: "week" | "two_weeks" | "month"): number {
  const perWeek = interval === "week" ? priceCents : interval === "two_weeks" ? priceCents / 2 : (priceCents * 12) / 52;
  return Math.round(perWeek * Math.max(quantity, 1));
}

/**
 * Skip week: a credit for one week's value on the Stripe customer balance,
 * applied automatically to the next invoice, so the owner never refunds by
 * hand. Unskipping reverses it. Recorded on the allowance row (idempotent).
 */
export async function applySkipCredit(subscriptionId: string, weekId: string, skip: boolean): Promise<number> {
  const admin = createAdminClient();
  const sub = await stripeSubscriptionFor(admin, subscriptionId);
  const { data: row } = await admin
    .from("subscription_allowances")
    .select("skip_credit_txn_id, skip_credit_cents")
    .eq("subscription_id", subscriptionId)
    .eq("menu_week_id", weekId)
    .maybeSingle();
  const customer = await ensureHouseholdCustomer(sub.household_id, admin);
  if (skip && !row?.skip_credit_txn_id) {
    const cents = weeklyValueCents(sub.plans.price_cents, sub.quantity, sub.plans.billing_interval);
    const txn = await stripe().customers.createBalanceTransaction(
      customer,
      { amount: -cents, currency: sub.plans.currency, description: "Skipped week credit", metadata: { subscription_id: sub.id, menu_week_id: weekId } },
      { idempotencyKey: `skip-credit:${sub.id}:${weekId}` },
    );
    must(await admin.rpc("stripe_set_skip_credit", { p_subscription: sub.id, p_week: weekId, p_txn: txn.id, p_cents: cents }));
    return cents;
  }
  if (!skip && row?.skip_credit_txn_id) {
    await stripe().customers.createBalanceTransaction(
      customer,
      {
        amount: row.skip_credit_cents as number,
        currency: sub.plans.currency,
        description: "Unskipped week (credit reversed)",
        metadata: { subscription_id: sub.id, menu_week_id: weekId },
      },
      { idempotencyKey: `skip-reverse:${sub.id}:${weekId}:${row.skip_credit_txn_id}` },
    );
    must(await admin.rpc("stripe_set_skip_credit", { p_subscription: sub.id, p_week: weekId, p_txn: null, p_cents: 0 }));
    return -(row.skip_credit_cents as number);
  }
  return 0;
}

/** Pause collection until a date (invoices are voided while paused), or resume. */
export async function setPause(subscriptionId: string, until: Date | null): Promise<void> {
  const admin = createAdminClient();
  const sub = await stripeSubscriptionFor(admin, subscriptionId);
  await stripe().subscriptions.update(sub.stripe_subscription_id!, {
    pause_collection: until ? { behavior: "void", resumes_at: Math.floor(until.getTime() / 1000) } : "",
  });
}

export async function setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void> {
  const admin = createAdminClient();
  const sub = await stripeSubscriptionFor(admin, subscriptionId);
  await stripe().subscriptions.update(sub.stripe_subscription_id!, { cancel_at_period_end: cancel });
}

/**
 * Change plan and/or number of children. Deliberately no proration: the
 * change applies from today and the next bill uses the new price; nothing is
 * charged or credited for the current period (explained before confirming).
 */
export async function changePlanOrQuantity(subscriptionId: string, opts: { planId?: string; quantity?: number }): Promise<void> {
  const admin = createAdminClient();
  const sub = await stripeSubscriptionFor(admin, subscriptionId);
  const stripeSub = await stripe().subscriptions.retrieve(sub.stripe_subscription_id!);
  const item = stripeSub.items.data[0];
  if (!item) throw new Error("This plan has no billable item.");
  const price = opts.planId ? await ensurePlanPrice(opts.planId, admin) : undefined;
  await stripe().subscriptions.update(sub.stripe_subscription_id!, {
    items: [{ id: item.id, ...(price ? { price } : {}), ...(opts.quantity ? { quantity: opts.quantity } : {}) }],
    proration_behavior: "none",
  });
}

/**
 * Stripe Customer Portal, used for payment methods and invoices only (plan
 * changes happen in-app so allowances stay in sync). The portal
 * configuration is created once and its id kept in site_settings.
 */
export async function customerPortalUrl(householdId: string, returnPath: string): Promise<string> {
  const admin = createAdminClient();
  const customer = await ensureHouseholdCustomer(householdId, admin);
  const { data: settings } = await admin.from("site_settings").select("stripe_portal_configuration_id, business_name").eq("id", true).single();
  let configuration = settings?.stripe_portal_configuration_id as string | null;
  if (!configuration) {
    const config = await stripe().billingPortal.configurations.create({
      business_profile: { headline: `${settings?.business_name ?? "Smart Cookie"}: payment details and receipts` },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ["email", "address"] },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
    });
    configuration = config.id;
    await admin.from("site_settings").update({ stripe_portal_configuration_id: configuration }).eq("id", true);
  }
  const session = await stripe().billingPortal.sessions.create({
    customer,
    configuration,
    return_url: new URL(returnPath, env.NEXT_PUBLIC_SITE_URL).toString(),
  });
  return session.url;
}

