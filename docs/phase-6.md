# Phase 6: Payments (Stripe)

Families pay by card, with **Link** to save details, for weekly orders or plans. Everything reconciles through Stripe webhooks, and the owner can see who has paid and issue refunds.

- **Stripe test mode only.** No live keys were used.
- **API version pinned:** `2026-11-18.endive` (`lib/stripe/server.ts`). I checked it against the current Stripe docs and changelog.
- **No card data touches our servers.** Stripe hosts the card fields (Payment Element), so PCI scope stays SAQ-A.

## What was built

### Customers

- **One Stripe Customer per household.** It's created on first checkout or first plan, with an idempotency key so two tabs can't create two customers. Its id is saved on `households.stripe_customer_id`.
- **Schools** get theirs in Phase 7.

### À la carte checkout: Payment Element (embedded)

- **Why the Payment Element rather than hosted Checkout:**
  - It sits inside our own checkout, after the allergy confirmation step that the proposal requires. Hosted Checkout would send families to another page and drop our styling.
  - Link and Apple/Google Pay appear automatically.
- **Payment methods:** card and Link only (`allowed_payment_method_types`). Apple Pay and Google Pay are card wallets, so they're included.
  - Your Dashboard also has Affirm, Klarna, Cash App and others enabled. They're deliberately left out for weekly kids' meals.
  - In this API version `payment_method_types` has been removed, and `allowed_payment_method_types` replaces `automatic_payment_methods`.
- **Flow:**
  1. `placeOrder` creates the order (`pending_payment`).
  2. `startPayment` creates a PaymentIntent for exactly what's owed, read from the database.
     - Metadata: `order_id` (and order number, household, payment version).
     - Idempotency key: order + payment version + kind + amount.
     - `setup_future_usage: off_session`, so a later change can be charged without re-entering the card.
  3. The browser confirms the payment.
  4. The `payment_intent.succeeded` webhook marks the order paid and queues the confirmation email.
- **The browser only ever shows "Confirming your payment…".** The webhook decides the outcome. If the webhook is slow, the processing screen asks Stripe directly from the server (`reconcileOrderPayments`); it never trusts the browser.
- **3D Secure:** Stripe's modal, or a redirect back to `/checkout?order=…`, which is detected and shows the processing screen.
- **Declined cards:** Stripe's message is shown ("Your card has insufficient funds."), and the order stays unpaid.
- **Abandoned checkouts:**
  - An unpaid new order holds its capacity for **30 minutes** (`orders.expires_at`).
  - `pg_cron` runs `expire_pending_orders()` every 5 minutes. It cancels the order and gives back any account credit it used.
  - If someone pays after their order expired, the webhook refunds them in full automatically.
- **Changing an order before cutoff** (Phase 5's "Change order"):
  - Phase 5 re-prices the order, then `settleOrderChange` handles the difference.
  - **More owed:** charged off-session to the card used for the order. If the bank wants the customer present (3DS) or there's no saved card, the family is prompted on-screen instead.
  - **Less owed:** a partial refund.
  - Cancelling an order refunds whatever was paid.
- **Account credit:**
  - Credits issued by the owner (the Phase 4 ledger) now pay first at checkout. The order gets a "credit" line.
  - Changed or cancelled orders give the credit back.

### Subscriptions: Payment Element + `subscriptions.create`

- **Creating the plan:** `payment_behavior: default_incomplete`, `save_default_payment_method: on_subscription`, card + Link.
  - Quantity is the number of children for per-child plans.
  - The client secret comes from `latest_invoice.confirmation_secret`, the current API's field.
  - Metadata carries our subscription id, so events that arrive early still find the row.
- **`invoice.paid`:** the plan becomes active and allowance rows are created or refreshed for every menu week that starts inside the paid period.
  - The allowance is capped by the subscription's quantity. A one-child plan covers one child's meals even if the family has two children.
- **Skip week:** the database enforces `allow_skip` and `max_skips_per_month`. Stripe then puts one week's value as a **credit on the customer balance**, which comes off the next invoice automatically. Unskipping reverses it. Both are idempotent and recorded on the allowance row.
- **Pause / resume:** `pause_collection` (`behavior: void`, `resumes_at`), mirrored to `paused_until` by the webhook.
- **Change plan / number of children:**
  - `subscriptions.update` with **no proration**: the change applies now, and the next bill uses the new price.
  - The UI explains this and asks before confirming.
  - A banner offers to bring the plan quantity in line when the number of kids changes.
- **Cancel:** at the end of the period, with the plan's minimum commitment respected. "Keep my plan" undoes it.
- **Extras beyond the allowance** are charged in the same à la carte PaymentIntent at checkout.
- **Customer Portal:** payment methods, receipts and address only. Plan switching and cancelling stay in-app so allowances stay in sync. The portal configuration is created once through the API, and its id is saved in `site_settings`.
- **Dunning:**
  - `invoice.payment_failed` queues the owner-editable `payment_failed` email, with an update-card link to `/subscription?billing=1`.
  - A past-due plan shows a red banner on the plan page and the order screen.
  - Meals stop being included until the card is fixed (the subscription is no longer "live").

### Webhooks (`/api/webhooks/stripe`)

1. The signature is checked against the **raw body**. A bad or missing signature gets a 400.
2. `stripe_claim_event` records `event.id` first, then claims it. Replays get 200 and are skipped. Failed events can be retried, and only one worker processes an event at a time.
3. Each event is applied through an atomic `stripe_*` SQL function (one transaction each), then marked processed. A failure answers 500 so Stripe retries.

**Events handled:**

- **Payments:** `payment_intent.succeeded`, `payment_failed`, `canceled`.
- **Refunds:** `charge.refunded`, `refund.created`, `updated`, `failed`.
- **Hosted Checkout:** `checkout.session.completed` is acknowledged; we don't use hosted Checkout.
- **Subscriptions:** `customer.subscription.created`, `updated`, `deleted`, `paused`, `resumed`.
- **Invoices:** `invoice.paid`, `payment_failed`, `finalized`, `voided`, `overdue` (school invoices are mirrored now; their UI is Phase 7).

**Out-of-order delivery:**

- Subscription events older than the newest one applied are ignored (`stripe_event_at`).
- `invoice.paid` arriving before `subscription.created` still finds the row through the invoice's `subscription_details.metadata`.

The service-role client is used only here, with a comment explaining why.

### Admin: payments

- **Orders list:** a **Payment** column and filter (Paid / Pending / Failed / Refunded / Part refunded / Invoiced / Overdue), so the owner can see who has paid.
- **Order detail** (`/admin/orders/[id]`):
  - Meals, totals (including credit), collected and refunded amounts.
  - Every PaymentIntent, linked to the Stripe dashboard, and every refund.
  - A **Check with Stripe** button in case a webhook was missed.
- **Refunds:**
  - Full or partial, by meal or by amount, with a reason.
  - Always asks for a **fresh authenticator code**.
  - Ops are capped by the owner's **per-refund limit** (Settings → Refunds, default $50, and changing it needs step-up). Owners are unlimited.
  - Nobody can refund more than was collected.
  - These rules are enforced in the database (`order_refunds` RLS + `can_refund`) and audited.
- **Credit / coupon:** issue account credit on the customer page (Phase 4, step-up); it now applies automatically at checkout. Create a one-time code in Discounts.
- **Revenue card on the dashboard:**
  - Collected this week and this month, net of refunds.
  - MRR from active plans and the number of active subscribers.
  - Estimated Stripe fees (2.9% + 30¢, labelled as an estimate).
  - A link to failed payments needing attention.

### Tax and fees

- **Off by default.** Settings → Tax offers a flat rate, or **Stripe Tax** behind a toggle with an "ask your accountant" note.
  - With Stripe Tax: a Tax Calculation from the delivery address for à la carte orders, and `automatic_tax` for subscriptions.
- **Fees** appear only as an estimate on the dashboard.

### Database (`20261125000100_payments.sql`)

- **New tables:** `order_payments` and `order_refunds`.
- **New columns:**
  - `orders`: `credit_cents`, `amount_paid_cents`, `amount_refunded_cents`, `payment_version`, `expires_at`, `payment_failed_at`, `last_payment_error`. The `orders_total_matches` check now includes credit.
  - `subscriptions`: `stripe_event_at`, `payment_failed_at`.
  - `subscription_allowances`: `skip_credit_txn_id` and `skip_credit_cents`.
  - `stripe_events`: claim columns.
  - `site_settings`: `ops_refund_limit_cents` (step-up guarded) and `stripe_portal_configuration_id`.
- **`_write_family_order`, updated:** the plan's quantity caps the allowance, credit applies first, and status follows net paid.
- **New functions:** the `stripe_*` bookkeeping functions (service role only) and `expire_pending_orders` (cron).

## How to test

Everyday checks:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm db:test
```

```bash
pnpm build && pnpm exec playwright test --trace off
```

With the placeholder keys (CI), payments use the mock provider. It drives the same `stripe_*` functions as real webhooks, and real-Stripe specs are skipped.

**Real Stripe test mode (local):**

1. Put a test secret key in `STRIPE_SECRET_KEY`, the matching `pk_test_` key in `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and a `whsec_` in `STRIPE_WEBHOOK_SECRET`.
2. Forward webhooks with the CLI, using `--latest` because your account's default API version is 2017:

```bash
stripe listen --latest --forward-to localhost:3000/api/webhooks/stripe
```

or with the CLI-free fallback, which re-reads each object at the pinned version:

```bash
pnpm stripe:forward
```

3. Run the real-Stripe specs:

```bash
pnpm exec playwright test e2e/payments.spec.ts e2e/refunds.spec.ts e2e/subscriptions-stripe.spec.ts --project=chromium
```

**Results:**

- **Unit tests (Vitest), 115:** Phase 6 adds the payment-status, MRR and fee helpers, the tamper tests (checkout inputs carry no amounts; extra fields are stripped) and the Sonner style hash.
- **DB tests (pgTAP), 218:** 31 new in `phase6.test.sql`:
  - Event claim, replay and retry.
  - Paid once, even when an event is replayed.
  - Families can read their own payments but can't change payment state or call webhook functions.
  - Kitchen staff can't refund; ops need fresh MFA and are capped by the limit; the owner is unlimited.
  - Nobody can refund more than is left; changing the refund limit needs step-up.
  - Full refund → order refunded.
  - Credit applied at checkout; the 30-minute expiry returns it.
  - Allowance capped by quantity.
- **E2E tests (Playwright):**
  - **CI mode:** 59 passed, 21 skipped (real-Stripe specs).
  - **Real test mode:** every spec passed, including:
    - Card 4242 paid, with the PaymentIntent amount equal to the server total.
    - 3D Secure completed on Stripe's challenge page.
    - Insufficient-funds decline shows its message.
    - Order change: top-up charged off-session, then a partial refund.
    - Admin refund by ops within the limit (and visible in Stripe) and over the limit (blocked).
    - The full **test-clock** plan life: start → allowances → skip credit on the balance → pause/resume → renewal creates the next allowances and uses the credit → failing card → `payment_failed` email + `past_due` + banner.
  - **Webhook tests** (signed events, run in CI): bad signature → 400, replay ignored, failure → refund, out-of-order invoice before subscription, stale update ignored, dunning email.

**Development sandbox caveat:** the network proxy here injects the secret key into every `api.stripe.com` request, including the browser's. That breaks Stripe.js's own confirm call, so the real-Stripe specs render and fill the real Payment Element but confirm with Stripe test cards through the API. Real browsers aren't affected.

**Link** has to be checked by hand on staging: pay once and tick "Save my information", then pay again and enter the test code `000000`.

## Go-live checklist (Stripe dashboard)

- [ ] **Account:**
  - [ ] Use a Stripe account for Smart Cookie. The test account used here belongs to "The Physics of Hiphop" (shown on the card form and 3DS page) and already sends webhooks to another app.
  - [ ] Complete business verification and add the payout bank account.
- [ ] **Branding:**
  - [ ] Statement descriptor **SMART COOKIE**: Settings → Business → Public details.
  - [ ] Logo and brand colour: Settings → Branding.
- [ ] **Payment methods:**
  - [ ] Turn on Card, **Link**, Apple Pay and Google Pay (Settings → Payment methods).
  - [ ] Optional: turn off the buy-now-pay-later methods (the app excludes them anyway).
- [ ] **Wallet domains:** register each production domain under Payment method domains so Apple Pay / Google Pay appear.
- [ ] **Webhook endpoint:**
  - [ ] Add `https://<domain>/api/webhooks/stripe` with API version **2026-11-18.endive**. Your account default is 2017-05-25, so pin it on the endpoint.
  - [ ] Select the events listed above.
  - [ ] Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
- [ ] **Customer Portal:** created automatically on first use (payment methods + invoices only). Check the business name and links in Settings → Billing → Customer portal.
- [ ] **Billing:**
  - [ ] Smart Retries and dunning emails (Settings → Billing → Subscriptions and emails). Our own `payment_failed` email also goes out.
  - [ ] Decide what happens after the final retry (recommended: mark the subscription unpaid).
- [ ] **Radar:** default rules are fine. Consider blocking prepaid cards for plans.
- [ ] **Stripe Tax** (if used): add registrations and set a prepared-food product tax code, after confirming with your accountant.
- [ ] **Vercel production env:**
  - [ ] Live `sk_live_` / `pk_live_` keys (the env schema requires live keys in production).
  - [ ] The live `whsec_`.
  - [ ] `CRON_SECRET`.
  - [ ] Roll any keys that were ever pasted into chat.

## Known gaps

- **Auto-filled orders:** subscription auto-fill orders with a delivery fee stay `pending_payment` and appear on the family's orders page with Pay now. Charging them off-session automatically is a small follow-up.
- **Plan rollover:** `rollover_unused` still isn't applied.
- **School invoices:** statuses are mirrored from webhooks; the school billing UI is Phase 7.
- **Link:** verified by hand only (see above), not automated.
- **Plan quantity:** changing the number of children asks the parent to update the plan quantity (no proration). It doesn't change automatically.
