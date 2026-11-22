// Local webhook forwarder for development without the Stripe CLI.
//
// Preferred: `stripe listen --latest --forward-to localhost:3000/api/webhooks/stripe`
// (put the whsec_… it prints in STRIPE_WEBHOOK_SECRET).
//
// This script is the fallback: it polls your TEST account's events, re-reads
// each object at the app's pinned API version (so payloads match production,
// whatever the account's default version is), signs the event with
// STRIPE_WEBHOOK_SECRET and POSTs it to the local webhook route.
//
//   NODE_USE_ENV_PROXY=1 node --env-file=.env.local scripts/stripe-forward.mts [url]
import Stripe from "stripe";

const API_VERSION = "2026-11-18.endive";
const url = process.argv[2] ?? "http://localhost:3000/api/webhooks/stripe";
const key = process.env.STRIPE_SECRET_KEY;
const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!key?.startsWith("sk_test_") || !secret) {
  console.error("Needs a TEST STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (refusing live keys).");
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: API_VERSION, httpClient: Stripe.createFetchHttpClient() });

const TYPES = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.finalized",
  "invoice.voided",
  "invoice.overdue",
];

async function refetch(type: string, id: string): Promise<unknown> {
  if (type.startsWith("payment_intent.")) return stripe.paymentIntents.retrieve(id);
  if (type.startsWith("charge.")) return stripe.charges.retrieve(id);
  if (type.startsWith("refund.")) return stripe.refunds.retrieve(id);
  if (type.startsWith("customer.subscription.")) return stripe.subscriptions.retrieve(id);
  if (type.startsWith("invoice.")) return stripe.invoices.retrieve(id);
  return null;
}

const seen = new Set<string>();
let since = Math.floor(Date.now() / 1000) - 5;
console.log(`Forwarding Stripe test events to ${url} (pinned ${API_VERSION}). Ctrl-C to stop.`);
for (;;) {
  try {
    const page = await stripe.events.list({ created: { gte: since }, types: TYPES, limit: 100 });
    for (const e of [...page.data].reverse()) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      since = Math.max(since, e.created - 2);
      const raw = e.data.object as { id?: string };
      if (!raw.id) continue;
      const object = await refetch(e.type, raw.id).catch(() => null);
      if (!object) continue;
      const payload = JSON.stringify({ ...e, api_version: API_VERSION, data: { object } });
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
      const res = await fetch(url, { method: "POST", body: payload, headers: { "content-type": "application/json", "stripe-signature": header } });
      console.log(`${e.type} ${e.id} → ${res.status} ${await res.text()}`);
    }
  } catch (error) {
    console.error("poll failed:", (error as Error).message);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
