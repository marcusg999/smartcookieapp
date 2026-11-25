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

/**
 * Pinned API version (Phase 6). It matches the version stripe-node 23.2 was
 * built for, so the TypeScript types describe what Stripe actually returns.
 * Upgrading is a deliberate change: bump stripe-node, then this, then test.
 */
export const STRIPE_API_VERSION = "2026-11-18.endive" as const;

let client: Stripe | null = null;
export function stripe(): Stripe {
  client ??= new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    // fetch-based transport: same behaviour on Vercel, and it honours an HTTPS
    // proxy where one is required (NODE_USE_ENV_PROXY=1).
    httpClient: Stripe.createFetchHttpClient(),
    appInfo: { name: "Smart Cookie" },
  });
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
 * Create a new Price (Prices are immutable). Call archivePrice on the old one
 * only AFTER the database points at the new id, so a failed save never leaves
 * the catalog pointing at an archived price.
 */
export async function createPrice(opts: {
  productId: string;
  unitAmount: number;
  currency: string;
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
  return price.id;
}

/**
 * Archive superseded prices (existing orders/subscriptions keep them; new
 * checkouts can't use them). Best effort: a failure is logged, not thrown,
 * because the new price is already live.
 */
export async function archivePrices(ids: (string | null | undefined)[]): Promise<void> {
  if (stripeMockMode()) return;
  for (const id of ids) {
    if (!id) continue;
    try {
      await stripe().prices.update(id, { active: false });
    } catch (error) {
      console.error("stripe: archiving a superseded price failed", { id, error: (error as Error).message });
    }
  }
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
