// Stripe webhook endpoint. Implemented in the payments phase: verify the
// signature with STRIPE_WEBHOOK_SECRET, store event.id for idempotency, and
// only then act on the event (CLAUDE.md §5.8). Until then, reject everything.
export function POST() {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}
