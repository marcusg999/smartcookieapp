# Phase 7: School portal

Schools get their own area at `/school`, with its own layout and navigation. Underneath it shares the menu and kitchen pipeline with families.

A school admin can:

- set up classrooms once;
- place standing orders sized by headcount;
- adjust any week before its cutoff;
- get one Stripe invoice a month, payable by card or ACH bank transfer.

Smart Cookie delivers to the school, labelled by classroom.

## What was built

### Onboarding

- **School sign-up** (Phase 2) creates a `pending` organization, and the owner is emailed (`school_application`, sent to the contact email in Settings).
- **Approval:** the owner or ops approve it in `/admin/schools/[id]`, setting:
  - billing terms (Net days);
  - the tax-exempt flag;
  - whether the school price list applies (owner only, needs a fresh authenticator code).
- **After approval** the school admins are emailed (`school_approved`). The first visit asks for school details at `/school/setup`: address, billing email, and drop-off entrance, contact, time window and notes.
- **Staff:** the school admin invites teachers and office staff at `/school/staff`.
  - The response is the same whether the email already has an account, so the form can't be used to find out who is registered.
  - Staff (`school_staff`) can see orders and classrooms and change a day's headcount. Only the admin can change billing or invite people. Both rules are enforced in the database.

### Classrooms

- **Setup:** name, teacher, grade, headcount and drop-off spot.
- **Roster linking:**
  - A parent picks the school and classroom on their child's profile. The link starts as **pending**, and parents can't approve it themselves.
  - The school admin approves or declines it under _Parent link requests_.
  - Once approved, the school sees the child's first name, last initial and allergies, through `school_roster()` only. It never sees the household, address, notes or payment details, and can't read the `children` table at all. This is stricter than Phase 3, which let schools read enrolled children's rows.
- **Allergy summary** ("Room 4: 2 Peanuts, 1 Milk"): linked children plus counts the school enters for children who aren't linked.

### Standing orders

- **Per classroom:**
  - weekdays;
  - start and optional end dates;
  - status (active / paused / ended / draft);
  - quantity: per headcount with a 0–50% buffer, or a fixed number per day;
  - notes for the kitchen.
- **Menu modes:**
  - **Chef's choice:** a main from the week's school-available items, rotating through the week.
  - **Specific items:** items per weekday. If an item isn't on that week's menu, the chef picks and the order is flagged for review.
  - **Category rotation:** for example "1 main + 1 side per child".
- **Allergy-safe alternates** (CLAUDE.md §6):
  - A linked child whose allergies clash with the day's item gets their own line with a safe alternative, labelled with their name.
  - Counts entered for unlinked children get per-allergen safe lines, which avoid "may contain" items too.
  - If no safe item exists, those meals are **left out** and the order is flagged **Please check this week**. A child is never given an item that clashes.
- **Materializing orders:**
  - Every hour, `pg_cron` runs `materialize_standing_orders()`. It turns standing orders into real `invoiced` orders (source `standing_order`) for each newly published week before its cutoff, and emails the school admins once per week: "Review by {cutoff}".
  - Any change re-plans open weeks immediately: standing order, classroom headcount, allergy counts, roster approval, a linked child's allergies, closures, approval or suspension, or the price list.
  - Weeks past their cutoff are locked and never touched.
- **Week view** (`/school/orders`):
  - Every day's lines, including allergy-safe ones.
  - Change a day's headcount, skip a day, or swap the meal, each re-priced immediately.
  - Undo a change, or mark the week reviewed.
  - All of it is refused after the cutoff.
- **School calendar** (`/school/calendar`): closure days are skipped automatically.
- **One-off bulk orders** (`/school/bulk`): events and staff lunches, with quantities, day, an optional classroom and a location. Invoiced monthly, and cancellable before the cutoff.

### Billing

- **School orders are `invoiced`**: they are never charged at checkout. Prices come from the school price list when it's on and an item has a school price; otherwise the week's normal price applies. Amounts never come from the browser.
- **Monthly invoicing:**
  - The daily Vercel cron `/api/cron/school-invoices` runs on the owner's _Monthly invoice day_ (Settings → School billing, default the 1st). It bills last month for every school with uninvoiced meals.
  - `prepare_school_invoice()` gathers the uninvoiced lines delivered up to the end of the period and locks them to the invoice, grouped by **classroom × week**.
  - It then creates a Stripe Invoice:
    - `send_invoice`, with `days_until_due` = the school's terms;
    - **card + ACH** (`us_bank_account`);
    - tax-exempt when flagged, flat-rate tax line otherwise; Stripe Tax if that's switched on.
  - It finalizes the invoice and emails the hosted payment link (`school_invoice`).
  - Every Stripe call has an idempotency key, so a failed run is finished by the next one.
- **Mid-month invoice:** ops or the owner can create one from the school's admin page ("Create invoice now").
- **`/school/billing`** (admin only):
  - outstanding balance and terms;
  - invoices (open / paid / overdue), with PDF and _Pay now_ links;
  - spend by classroom and month.
- **Webhooks:**
  - `invoice.finalized`, `paid`, `voided`, `marked_uncollectible`, `overdue` and `payment_failed` update the school invoice.
  - A late `finalized` never re-opens a paid invoice.
  - Voiding releases the meals onto the next invoice.
- **Overdue:**
  - A daily `pg_cron` job flags overdue invoices for the admin and queues reminder emails at **+3 and +7 days** (`school_invoice_reminder`, skipped if the invoice was paid in the meantime).
  - The owner can set _pause new standing-order weeks when an invoice is N days overdue_. Weeks already planned stay.
- **Check / PO payments:** the owner marks an invoice paid out of band with the check or PO number. This needs a fresh authenticator code, is audited, and is mirrored in Stripe with `paid_out_of_band`.

### School dashboard (`/school`)

- next cutoff, with a countdown;
- things to review: orders for next week, and parent link requests;
- students and classrooms;
- outstanding balance (admin);
- this week day by day: meals per classroom, with allergy-safe counts in red.

### Admin (`/admin/schools`)

- **Accounts receivable** aging per school (current, 1–30, 31–60, 60+ days), with overdue flags.
- **School page:**
  - approve, decline or suspend; terms, tax and contact details;
  - the school's drop-off details;
  - the price list switch (owner);
  - "Re-plan open weeks";
  - **adjust any standing order** (same form as the school's);
  - invoices: create now, retry a draft, view in Stripe, paid by check or PO.

### Database (`20261126000100_school_portal.sql`)

- **New tables** (RLS on, scoped by organization):
  - `classroom_allergy_counts`
  - `standing_order_adjustments`
  - `school_closures`
  - `invoice_lines`
- **New columns:**
  - organizations: onboarding and drop-off fields, plus `use_school_pricing`;
  - children: `school_link_status`;
  - standing_orders: `buffer_percent`, `day_items`, `rotation`;
  - orders: `standing_order_id`, review flags, `dropoff_location`;
  - order_items: `safe_for_allergens`, `invoice_id`;
  - invoices: Stripe, payment and reminder fields;
  - site_settings: invoice day and overdue suspension;
  - notifications_log: `organization_id`.
- **Kitchen view:** `kitchen_order_lines` gains `safe_for_allergens`, `dropoff_location` and `order_source`, ready for Phase 8 labels.
- **Writes go through security-definer functions** that re-check the role, the organization and the week's cutoff:
  - `set_standing_order_day`
  - `set_school_closure`
  - `create_school_bulk_order`
  - `review_school_link`
  - `prepare_school_invoice`
  - `mark_invoice_paid_out_of_band`
  - …
- **Email templates** are inserted by the migration (`on conflict do nothing`), so production gets them too: `school_application`, `school_approved`, `school_week_ready`, `school_invoice`, `school_invoice_reminder`.

### Bugs found and fixed along the way

1. **Parents couldn't link a child to a classroom at all** (since Phase 3). The classroom check ran with the parent's rights and couldn't see school classrooms. It now runs with definer rights and also requires an approved school.
2. **A null role check skipped permission checks.** For someone with no role in a school, `org_role()` returns null, and `not (null …)` is null, so school B could have edited school A's standing order. All school checks are now null-safe, and pgTAP proves cross-school access is denied.

## How to test

```bash
pnpm db:reset && pnpm db:test
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
pnpm build && pnpm exec playwright test --trace off
```

With the placeholder keys, invoicing uses a mock that drives the same bookkeeping as Stripe's webhooks.

**Real Stripe test mode:** set your test keys, run `pnpm stripe:forward` (or `stripe listen --latest …`), then:

```bash
pnpm exec playwright test e2e/school.spec.ts --project=chromium
```

**Seed data:** `school@smartcookie.test` (school admin) and `teacher@smartcookie.test` (staff) at Maple Grove Elementary. The password is in `docs/phase-3.md`. The school has three classrooms, a chef's-choice standing order for Room 4, and two linked children.

**Results:**

- **DB tests (pgTAP), 277 (59 new in `phase7.test.sql`):**
  - Materializing an order, with the buffer and school pricing.
  - Past-cutoff weeks never materialized.
  - A holiday skipped; a headcount change re-prices before the cutoff and is refused after.
  - A classroom headcount change re-plans the week.
  - Roster linking: pending, staff can't see requests, approval reveals allergies, and the school never reads `children`.
  - Allergy-safe alternates for linked children and for counts; "no safe option" leaves the meal out and flags the order.
  - Bulk orders: admin only.
  - Cross-organization denial for classrooms, orders, standing orders, the calendar, allergy summaries, changes and invoices.
  - Invoice total = sum of the month's orders; lines add up; resuming is idempotent.
  - Staff can't see invoices, change billing or invite.
  - Webhook functions are service-role only.
  - Paying by check needs the owner with fresh MFA.
  - The price list is owner only.
  - Billing hold.
  - The kitchen sees safe-for labels; anon is denied.
- **Unit tests (Vitest), 148 (12 new):**
  - Invoice period, overdue state, days overdue.
  - Week picking and open checks.
  - Tamper tests: no prices accepted, extra fields stripped, limits enforced.
- **E2E tests (Playwright):**
  - New school: details → standing order → weekly order → change a day → skip a day → close a day → bulk order.
  - Staff can't reach billing; the admin approves a parent's link and sees the allergy.
  - The owner creates a mid-month invoice, the school sees _Pay now_, and the owner records a check payment (step-up).
  - **Real Stripe:** the invoice's total and card + ACH settings are checked in Stripe, it is paid by **test ACH** (microdeposits 32/45 + an offline mandate), and the webhook marks it paid.
  - **Signed webhooks:** paid → paid; a late finalized doesn't re-open it; voided releases the meals.
  - **Full suite:** 64 passed in CI mode. Real Stripe test mode: all payment, refund, subscription and school specs passed.
- **Mobile:** every `/school` page checked at 375px, with no horizontal overflow.

## Stripe dashboard (add to the Phase 6 go-live checklist)

- [ ] **ACH Direct Debit** turned on (Settings → Payment methods). Invoices offer card + ACH.
- [ ] **Webhook endpoint:** also subscribe to `invoice.marked_uncollectible` (the other invoice events are already on the list).
- [ ] **Overdue events:** Settings → Billing → Invoices → turn on overdue invoice events if you want Stripe's `invoice.overdue` as well. The app also flags overdue invoices itself daily.
- [ ] **Invoice branding:** public business name, logo and support email. The invoice page and PDF show these.
- [ ] **Cron:** Vercel runs `/api/cron/school-invoices` daily (in `vercel.json`); it needs `CRON_SECRET`.

## Known gaps

- **Menu edits after publishing:** editing a published week's menu doesn't re-plan school orders on its own. Use _Re-plan open weeks_ on the school's admin page.
- **Capacity:** school orders count toward an item's capacity, but aren't blocked by it.
- **Bulk orders** aren't matched to individual children's allergies. Each item's allergens are shown when ordering.
- **Invoice emails:** Stripe's own invoice emails aren't sent. The school gets our owner-editable email with the hosted link, so there's no duplicate. Stripe's reminders can be turned on in the dashboard instead.
- **Staff invites for existing accounts:** an email that already has an account gets access without a separate notice. Phase 9 adds the staff invitation email.
- **Catch-up billing:** a monthly invoice also picks up any older uninvoiced meals (e.g. after a failed run), not only that month's.
- **Scheduled jobs need staging:** materialization and reminders run in `pg_cron`, and invoices in Vercel Cron. In local development, run them by hand:
  - `select public.materialize_standing_orders();`
  - `select public.queue_school_invoice_reminders();`
  - `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/school-invoices`
- **Acceptance run:** a full month in staging with the kitchen view (Phase 8) is still to do. Every step it needs is in place and tested here: standing orders → weekly orders → monthly invoice → ACH payment.
