# Phase 5: Family experience

Goal: a parent goes from sign-up to a placed weekly order in under 3 minutes the first time, and in seconds on repeat weeks. Payment is mocked behind an interface; Stripe arrives in Phase 6.

## What was built

### Public site (every word from the CMS)

- **Home:** scroll-packed lunch-tray hero, a moving benefits ribbon, "this week" sample meals, how it works, plan overview with prices, a swipeable testimonial carousel, the schools band, an FAQ teaser and a closing call to action.
- **New pages:** `/plans` (cards plus a comparison table), `/schools` (sign-up call to action pre-selects a school account), `/faq` (grouped, accordion). About and policies still come from CMS pages (`/[slug]`) and are now linked in the footer.
- **Navigation:** Menu, How it works, Plans, For schools, FAQ. Signed-in visitors see **My account** instead of Sign in / Get started.
- **SEO:**
  - Site title and description come from settings and the CMS (`seo.*` keys), with per-page descriptions.
  - `sitemap.xml` includes every published CMS page.
  - `robots.txt` blocks everything outside production, and only private areas in production.
  - LocalBusiness JSON-LD on the home page, behind the CSP nonce, with service areas taken from delivery zones.
- **Motion** (CSS only, all switched off under `prefers-reduced-motion`):
  - Cards ease in as they scroll into view (`animation-timeline: view()`).
  - A marquee that pauses on hover or focus.
  - A floating mascot, and a pop when you favourite a meal.
  - The WebGL shader from Phase 1 now starts only after the first interaction, once it's near the viewport, capped at 30 fps.

#### Ideas taken from the reference sites

- **nurturelife.com:**
  - The benefit ribbon.
  - Prices shown on the plan overview.
  - "Plans change? Skip or pause any time" messaging.
  - The testimonial carousel.
  - The FAQ teaser, with an allergy statement in the FAQ.
  - Onboarding as a short guided quiz (our four steps).
- **sprwt.io:**
  - Diet and allergy rules applied automatically to the menu.
  - Saved and auto-filled orders.
  - Discount codes at checkout.
  - The kitchen-side packing and label ideas are noted for the kitchen phase.

### Onboarding (`/welcome`)

The first sign-in redirects here. Each step can be skipped, and the account home keeps nudging until onboarding is finished.

1. **Household:** household name and mobile number.
2. **Address:**
   - The ZIP is checked against delivery zones and the result shows the zone and its delivery days.
   - Outside every zone, the parent sees the "not in your area yet" message and can join the waitlist (`zone_waitlist`).
   - A **Deliver to school instead** button highlights the school and classroom picker on the next step.
3. **Kids:**
   - First name and last initial.
   - Optional school, classroom and grade.
   - Big tappable allergy chips for the top 9 plus any allergens the owner adds, each with a severity (intolerance, allergy, or severe, which also blocks "may contain").
   - Dietary badges and notes.
4. **How to order:** à la carte, or a plan, with plan cards built from the database.

### Weekly ordering (`/order`)

- **Header:** week, delivery days, the cutoff in the business timezone and a live countdown. Once the cutoff passes, that week is locked and the next one is shown, with a notice.
- **Child tabs:** each tab shows the child's allergy chips in red. Under the tabs: a delivery-day picker and category filter.
- **Meal cards:**
  - Badges, allergens in red, price, and a ♥ favourite button.
  - A meal containing the active child's allergen shows **Unavailable for {child}** with the reason. It is never hidden, and there is no Add button.
  - Owner-approved exceptions are respected and labelled.
  - "May contain" warnings appear when the allergy isn't severe.
- **Add snacks** section.
- **Subscribers:**
  - A per-child (or household) allowance meter.
  - **Included** badges on meals the plan still covers.
  - Extras are shown at menu price.
  - **Skip this week**, following the plan's rules.
- **Cart bar:**
  - Fixed above the phone tab bar, with a running subtotal from server prices.
  - Opens a drawer grouped by child and day.
  - The cart is saved on the server (`carts`, one per household per week), and the server drops any line that clashes with a child's allergies.
- **Repeat last week:** one tap here, or one tap on the account home, which runs it on arrival.
  - Same weekday → this week's matching (or nearest) delivery day.
  - A meal that isn't on this week's menu is swapped for one from the same category that's safe for that child, preferring fewer allergens.
  - Swaps are highlighted in the drawer. Lines with no safe option are dropped and reported.
- **Fill week with favourites:** child favourites first, then household favourites, one main per child per day, allergy-safe.
- **Saved orders:** name and save a combination ("Mon–Wed usual") and apply it to any week by weekday.
- **Subscription auto-fill at cutoff:**
  - `pg_cron` runs `auto_fill_due_weeks()` every 15 minutes.
  - It picks favourites, then chef's choice, using the same allergy check as a parent's order.
  - It queues an email; `/api/cron/notifications` (Vercel Cron, bearer `CRON_SECRET`) sends the owner-editable `subscription_autofill` template.
  - A household that can't be filled safely gets `subscription_autofill_failed` instead of a guess.

### Checkout (`/checkout`)

1. **Review:** by child and day. Includes a discount code (preview is rate limited), the zone delivery fee with its free-over threshold, and a minimum-order check that blocks continuing.
2. **Delivery:** the saved default address is preselected. School drop-off is offered when every child in the cart has a school.
3. **Allergy confirmation (last step):**
   - Each child's allergies are listed with **Still correct** or **Edit**.
   - The owner-editable disclaimer is shown.
   - Returning families can confirm everyone and place the order in one tap.
   - The order can't be placed without confirmation; `allergy_confirmed_at` and `allergy_confirmed_by` are recorded.
4. **Payment:** `lib/payments/provider.ts`.
   - Mock provider locally (`sk_test_dummy`). Phase 6 swaps in Stripe behind the same interface.
   - The step renders from the saved order (`/checkout?order=…`), so a refresh never loses it.
   - Fully included orders are marked paid straight away.

**`placeOrder`** sends only the week, the delivery choice, the code and the allergy confirmation. The lines come from the server-side cart, and the database function `place_family_order` → `_write_family_order` re-validates everything in one transaction:

- Cutoff, using database time and the business timezone.
- The meal is on this published week, for families.
- Delivery day and zone weekday.
- Child ownership.
- Allergies, using `_blocking_allergens`, which works for system jobs too.
- Capacity: the week's menu rows are locked `FOR UPDATE`, then counted.
- Prices, zone fee and minimum, the discount (redeemed once), flat-rate tax when enabled, and the plan allowance (covered and paid units are separate lines).

The order is created in `pending_payment`, or `paid` when its total is $0. Changing an order re-prices it in place.

### Account area

- **Home:** this week's status (ordered, skipped, or not yet, with a countdown) and quick actions (Repeat last week, Order now, Skip week). Links to Kids, Plan, Addresses, Saved orders, Security and Privacy.
- **Orders** (`/orders`, `/orders/[id]`):
  - Upcoming and past orders.
  - Detail by child, with allergens in red, totals, delivery details and the allergy confirmation.
  - Change (loads the order back into the cart) or cancel until the cutoff, with the refund policy from the CMS. Pay now if payment is pending.
- **Kids (`/children`):** add, edit and remove. Saving allergies re-checks upcoming orders and lists conflicts (`upcoming_allergy_conflicts`).
- **Plan (`/subscription`):**
  - Plan, status and next bill.
  - Pause until a date, resume, cancel at the end of the period (respecting minimum commitment), or keep the plan.
  - Switch plan (pending until the next period).
  - Skip or unskip upcoming weeks.
  - Starting a plan creates an `incomplete` subscription that the provider activates.
- **Addresses:** add, choose the default (which updates the household's zone), delete, and a note when a ZIP isn't covered.
- **Security and Privacy:** all copy is now in the CMS. Phase 4's allow-list in the copy test is gone, and the test now also scans `components/family` and `components/marketing`.

### Pilot mode

With `site_settings.pilot_mode` on, sign-up shows an **Invite code** field. The server checks it (rate limited, behind Turnstile), and the `handle_new_user` trigger re-checks and redeems it. Owner-invited staff are exempt. The menu stays public.

### Database (`20261124000100_family_experience.sql`)

- **New tables:**
  - `carts`: household members only.
  - `zone_waitlist`: members insert and read their own; ops and owner read all.
- **New columns:**
  - `households`: `onboarded_at`, `ordering_preference`, `preferred_plan_id`.
  - `subscriptions.pending_plan_id`.
  - `menu_weeks.auto_filled_at`.
  - `notifications_log`: `payload`, `household_id`, and a `sending` status.
- **Functions:**
  - Orders and discounts: `place_family_order`, `cancel_family_order`, `preview_discount`.
  - Subscriptions: `set_subscription_week_skip`, `request_subscription_change`, `request_plan_change`, `create_pending_subscription`.
  - Lookups: `upcoming_allergy_conflicts`, `zone_for_zip`, `partner_schools`, `pilot_code_is_valid`, `plan_weekly_share`.
  - System only (service role or `pg_cron`): `auto_fill_week`, `auto_fill_due_weeks`.
  - Internal (not callable from the API): `_write_family_order`, `_blocking_allergens`, `_live_subscription`, `_recount_allowance`.
- **Replaced:** `create_family_order`.
- **New policy:** "Members read their children" (by household). The old `can_view_child()` lookup can't see a row inserted in the same statement, which broke `INSERT … RETURNING` for a new child.
- **Seed:** a peanut dish in both rotation templates (so the allergy block can be demoed), auto-fill email templates, and the demo families marked as onboarded.

**Allowance rule:** a plan's meals per billing interval are spread across weeks.

- Weekly plans: the plan's number of meals.
- Two-week plans: half, rounded up.
- Monthly plans: × 12 / 52, rounded up.

## How to test

```bash
pnpm exec supabase db reset
```

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:test
```

```bash
pnpm build && pnpm exec playwright test --trace off
```

- **Unit tests (Vitest), 107:**
  - `lib/ordering/logic.test.ts`: price calculation, allowance math, swap suggestions, allergy rules, and the cutoff across DST in America/Los_Angeles (spring-forward and fall-back Sundays).
  - The CSP test now also re-derives Sonner's style hash from `node_modules`.
- **DB tests (pgTAP), 187:** 53 new in `supabase/tests/phase5.test.sql`:
  - Carts, waitlist and onboarding: the right role can, other parents can't, anon can't.
  - Placing an order needs the allergy confirmation; the peanut block holds.
  - Server pricing with fee and discount; capacity; modify re-prices; cancel.
  - Cutoff rejected in database time.
  - Allowance (included and extra), skip rules, and auto-fill never picking an allergen.
  - Pilot-mode sign-up.
- **E2E tests (Playwright), 53 passed, 4 skipped:** `e2e/family.spec.ts`, desktop and Pixel 7:
  - First-time parent: onboarding → two kids → allergy step → pay.
  - A peanut-allergic child can't be given the peanut meal, in the UI or through a direct database call.
  - Repeat last week from the account home in one tap.
  - An order after the cutoff is rejected server-side when the UI is bypassed.
  - Public pages, sitemap and JSON-LD.
- **Manual:** `parent@smartcookie.test` / `SmartCookie-local-2026!` (Maya has a severe sesame allergy, Leo a milk allergy). To try pilot mode, turn it on in Admin → Settings and use code `PILOT-FAMILY-01`.
- **Auto-fill locally:**
  1. Run `select public.auto_fill_week('<week id>');` in SQL.
  2. Call `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/notifications`.
- **Lighthouse (mobile, production build, this container, no GPU):**
  - Home: performance 89–96 (median 90), accessibility 100.
  - Menu: performance 90–91, accessibility 100.
  - Measured LCP is about 0.2 s; Lighthouse's simulated slow-4G LCP is about 3.5 s, mostly from the client JavaScript (the Sentry SDK is the largest chunk).
- **Checks:**
  - 375px: no horizontal scroll (smoke test, plus manual screenshots of home, plans, schools, FAQ, order, account).
  - No secrets in `.next/static`; the two pattern hits are library strings.

## Known gaps

- **Payments:** mocked. Stripe Payment Element, Billing, refunds and price differences on changed orders come in Phase 6. A paid order whose total changes goes back to `pending_payment`.
- **Plan rollover:** `rollover_unused` isn't applied yet, and allowances count per menu week only.
- **Tax:** a flat `rate_bps` from settings when enabled, shown after placement. Stripe Tax comes in Phase 6.
- **Discount codes:** only `applies_to.scope = "all"` is supported.
- **Pilot mode:** with pilot mode on, Google, Apple and magic-link sign-ups for new emails fail with a generic error, because there is no code field in those flows.
- **One order per week:** each household has one live order per week. A second checkout creates a second order; "Change order" is the guided path.
- **Lighthouse:** Home performance hovers around 90 here. The biggest remaining lever is loading the Sentry browser SDK lazily, which would trade away capturing very early errors. That's a decision for you.
- **Robots:** `robots.txt` disallows everything outside production, which is why Lighthouse SEO shows 63 locally.
- **Ops setup:** set `CRON_SECRET` in Vercel; `vercel.json` schedules the notifications job.
