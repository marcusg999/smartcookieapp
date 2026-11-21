import "server-only";

import Stripe from "stripe";

import { env } from "@/lib/env";

/**
 * Server-only Stripe access (CLAUDE.md §5.8). While the environment has the
 * placeholder keys from .env.example (local/CI), catalog calls run in MOCK
 * mode and return fake `*_mock_*` ids, so the admin flows work without a
 * Stripe account. Real keys switch to the live API automatically.
 */
export function stripeMockMode(): boolean {
  return /^(sk|rk)_test_(ci_)?dummy$/.test(env.STRIPE_SECRET_KEY);
}

let client: Stripe | null = null;
function stripe(): Stripe {
  client ??= new Stripe(env.STRIPE_SECRET_KEY, { appInfo: { name: "Smart Cookie" } });
  return client;
}

function mockId(prefix: string): string {
  return `${prefix}_mock_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Ensure a Product exists for a catalog item; returns its id. */
export async function ensureProduct(opts: {
  productId?: string | null;
  name: string;
  metadata: Record<string, string>;
}) {
  if (opts.productId) return opts.productId;
  if (stripeMockMode()) return mockId("prod");
  const product = await stripe().products.create({ name: opts.name, metadata: opts.metadata });
  return product.id;
}

/**
 * Create a new Price (Prices are immutable) and archive the previous one.
 * Existing orders/subscriptions keep the old price; new checkouts use the new one.
 */
export async function replacePrice(opts: {
  productId: string;
  unitAmount: number;
  currency: string;
  previousPriceId?: string | null;
  recurring?: { interval: "week" | "month"; interval_count: number } | null;
  metadata?: Record<string, string>;
}): Promise<string> {
  if (stripeMockMode()) return mockId("price");
  const price = await stripe().prices.create({
    product: opts.productId,
    unit_amount: opts.unitAmount,
    currency: opts.currency,
    recurring: opts.recurring ?? undefined,
    metadata: opts.metadata,
  });
  if (opts.previousPriceId) await stripe().prices.update(opts.previousPriceId, { active: false });
  return price.id;
}

/**
 * Move existing subscribers on a plan to a new price at their NEXT renewal.
 * proration_behavior "none": nobody is charged or credited mid-period; the
 * new amount simply applies from the next invoice.
 */
export async function moveSubscriptionsToPrice(subscriptionIds: string[], newPriceId: string): Promise<number> {
  if (stripeMockMode() || subscriptionIds.length === 0) return subscriptionIds.length;
  let moved = 0;
  for (const id of subscriptionIds) {
    const sub = await stripe().subscriptions.retrieve(id);
    const item = sub.items.data[0];
    if (!item) continue;
    await stripe().subscriptions.update(id, {
      items: [{ id: item.id, price: newPriceId }],
      proration_behavior: "none",
    });
    moved++;
  }
  return moved;
}

export function planRecurring(interval: "week" | "two_weeks" | "month") {
  return interval === "month"
    ? { interval: "month" as const, interval_count: 1 }
    : { interval: "week" as const, interval_count: interval === "two_weeks" ? 2 : 1 };
}
