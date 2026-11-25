# QA (Phase 10)

## Regression suite

| Layer                   | Command                                 | What it covers                                                                                                                                      | Status                                                        |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Database (pgTAP)        | `pnpm db:test`                          | RLS for every role, money/allergy/cutoff rules, triggers, jobs, time edge cases, security fixes                                                     | 403 tests pass                                                |
| Unit (Vitest)           | `pnpm test`                             | Pricing, allowances, DST cutoffs, email rendering and escaping, sanitizer, env rules, every Server Action guarded                                   | 322 tests pass                                                |
| End to end (Playwright) | `pnpm test:e2e`                         | Every role: family ordering and payment, subscriptions, school portal and invoicing, kitchen, admin, emails, pilot, security attacks, accessibility | 133 tests (desktop Chrome + Pixel 7); green locally and in CI |
| Staging                 | GitHub Actions → **Staging regression** | The same suite against the staging deployment after every staging deploy (skips the `@local-only` tests that read the local Mailpit inbox)          | Workflow ready; runs once staging is connected                |

Run order for a release: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test`, `pnpm build`, `pnpm test:e2e`. CI does all of this on every pull request, plus a full-history secret scan.

## Cross-device matrix

Automated runs cover desktop Chromium (1280 px) and a Pixel 7 emulation (412 px). Mobile layout is also checked at 375 px (no horizontal scroll, e2e). The rest needs real devices; tick each during the staging dry run.

| Device / browser                   | Who / how               | Family ordering | Checkout (Stripe, Apple/Google Pay) | Account, kids | School portal | Admin + kitchen                     | Status           |
| ---------------------------------- | ----------------------- | --------------- | ----------------------------------- | ------------- | ------------- | ----------------------------------- | ---------------- |
| Desktop Chrome                     | Automated (Playwright)  | ✅              | ✅ (test cards)                     | ✅            | ✅            | ✅                                  | Pass             |
| Android Chrome (Pixel 7 emulation) | Automated               | ✅              | ✅                                  | ✅            | ✅            | ✅                                  | Pass             |
| iPhone Safari (iOS 18+)            | Manual, real phone      | ☐               | ☐ Apple Pay                         | ☐             | ☐             | —                                   | To do on staging |
| Android Chrome (real phone)        | Manual                  | ☐               | ☐ Google Pay                        | ☐             | ☐             | —                                   | To do on staging |
| iPad Safari                        | Manual (kitchen tablet) | —               | —                                   | —             | ☐             | ☐ cook list, labels, packing, print | To do on staging |
| Desktop Safari                     | Manual                  | ☐               | ☐                                   | ☐             | ☐             | ☐                                   | To do on staging |
| Desktop Firefox                    | Manual                  | ☐               | ☐                                   | ☐             | ☐             | ☐                                   | To do on staging |

Things to try by hand on each: install as an app (PWA), sign in with a passkey, the order screen's allergy blocks, the checkout allergy confirmation, printing labels (Avery 5163) from the kitchen tablet, and the feedback button (pilot family).

## Accessibility

axe (WCAG 2.2 AA tags) runs in e2e on the public site, the family area, the school portal and **every** static admin screen (31 pages, as owner): zero serious or critical violations. Keyboard: skip link, visible focus, labelled inputs (e2e + review). See `docs/compliance.md` for the California (Unruh/ADA) notes.

## Load sanity: the Thursday-night cutoff rush

`pnpm load:cutoff` (local Supabase; `LOAD_FAMILIES`, `LOAD_CAPACITY` to change the numbers) creates 200 families and has all of them order the same capacity-limited meal **at the same instant**, through the same database function checkout uses (cutoff, zone, minimum, allergies, capacity, pricing).

Result on the development container (2026-11-25), 200 simultaneous orders, 150 meals left:

| Measure                 | Result                                            | Target                 |
| ----------------------- | ------------------------------------------------- | ---------------------- |
| Orders accepted         | 150                                               | = capacity             |
| Refused                 | 50, all "sold out this week"                      | only capacity refusals |
| Oversold                | No (173 of 173 reserved, incl. 23 earlier orders) | never                  |
| Latency p50 / p95 / max | 865 / 1,495 / 1,546 ms                            | p95 < 1.5 s            |

p95 just meets the target here, with every order arriving in the same instant (a real rush is spread over minutes) on a small shared container. Repeat on staging (Supabase's hosted Postgres) during the dry run. Capacity is enforced by locking the week's meal row inside the order transaction, so overselling can't happen even if latency grows.

## Time edge cases

| Case                                                                                                               | Test                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Cutoff on either side of a DST change (spring forward, fall back, cutoff on the change day itself)                 | `lib/ordering/logic.test.ts` (app) and `supabase/tests/phase10_time.test.sql` (database, which enforces it) |
| An order at the exact cutoff second is refused; one second before is accepted                                      | `phase10_time.test.sql` (cutoff is inclusive: `now() >= cutoff` closes)                                     |
| A delivery week spanning a month boundary is split across the two monthly school invoices, each line invoiced once | `phase10_time.test.sql`                                                                                     |
| Countdown closes at the cutoff                                                                                     | `logic.test.ts`                                                                                             |
