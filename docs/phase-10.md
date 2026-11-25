# Phase 10: Security hardening, QA, pilot program and go-live

## What was built

### A. Security review (`docs/security-review.md`)

- **SR-01, critical, fixed**: anyone with the public API key could rewrite published site copy and policy pages through the auto-updatable public views. The views are now function-backed, `security_invoker` and read-only; a pgTAP check fails if any view becomes writable or security-definer again.
- **SR-02**: pilot invite codes are checked server-side only (no guessing through the API).
- **SR-03**: `/\host` links rejected in rich text, CMS buttons and the banner.
- **SR-04/05 (privacy)**: account deletion now closes the household and archives the children at once; their data is purged after the owner's retention period (default 24 months). The CCPA export now covers every family table. Deletion waits until any plan is cancelled.
- Covering indexes for all 63 foreign keys; `auth_attempts` primary key. Advisors are clean apart from documented, accepted items.
- **AuthZ test**: every exported Server Action must start with a guard (128 checked).
- **Attack tests (e2e)**: IDOR across households, privilege escalation and mass assignment through the API, magic-link reuse, password brute force, open redirects, CCPA export and delete.
- **Secrets**: gitleaks full-history scan in CI; client bundle checked; no secrets in history.
- **Dependencies**: `pnpm audit` clean.
- **Monitoring**: `/api/health` for uptime checks; a daily payment health job (stuck payments, Stripe/app mismatches, failed Stripe events) emails the owner.
- **Production data**: `supabase/bootstrap.sql` holds the reference data every environment needs (allergens, badges, categories, all site copy, policy pages, starter FAQs). It is idempotent, loaded with `pnpm db:bootstrap`. Demo data stays in `seed.sql`. **Privacy policy and terms** are full drafts for lawyer review (unpublished).

### B. QA (`docs/qa.md`)

- Regression suite: 403 database tests, 322 unit tests, 133 e2e tests (desktop + mobile), all green. A **Staging regression** workflow runs e2e against staging after each staging deploy.
- Accessibility: axe on the public site, family area, school portal and **all 31 static admin screens**: zero serious/critical issues.
- **Load**: `pnpm load:cutoff` sends 200 simultaneous orders at a meal with 150 left: 150 accepted, 50 "sold out", **no overselling**, p95 1,495 ms (target 1.5 s; tight on this container, repeat on staging).
- **Time edge cases** in the database: DST cutoffs, the exact cutoff second (refused) vs one second before (accepted), a delivery week across a month boundary split between invoices.
- Device matrix: automated desktop Chrome and Pixel 7; iPhone/iPad Safari, real Android, desktop Safari/Firefox to tick during the staging dry run.

### C. Pilot program

- **Admin → Pilot** (owner): success criteria with editable targets (week-2 reorder %, median repeat-order time, allergy incidents), pilot families at a glance (signed up → set up → first order → repeat; median first/repeat order time; average rating), "where orders stop" (cart → checkout → allergy confirmation → paid), invites (email with a code and a pre-filled sign-up link, or a code to share), the pilot families list, and feedback with "mark handled". Pilot mode toggle.
- **Feedback button** for pilot families on every family page: "How was ordering this week?" 1–5 + comment, and "Something confusing?" with the page path. RLS: pilot families only, own household only.
- **Funnel metrics** come from our own database (triggers on carts and orders). No analytics scripts or cookies, as you chose.
- Owner can add an existing family to the pilot from their customer page.

### D/E. Go-live and handoff

- `docs/go-live.md`: the step-by-step runbook (Supabase, Auth, SMTP, templates, Stripe live, DNS, Vercel, crons, monitoring, backups and the restore drill, the owner content pass, pilot, launch, hypercare) with a dry-run log.
- `docs/owner-guide.md` (for Hannah) and `docs/developer-guide.md` (architecture, RLS model, adding content and emails, deployment, incident response).
- Local dry run of the production path: migrations + bootstrap only → public pages render with launch copy, `/api/health` is 200, `owner:bootstrap` grants the first owner and refuses a second run.

## How to test

```bash
pnpm db:test
```

```bash
pnpm test
```

```bash
pnpm exec playwright test e2e/security.spec.ts e2e/pilot.spec.ts e2e/a11y-kitchen.spec.ts
```

```bash
pnpm load:cutoff
```

By hand: sign in as the seeded owner, open Admin → Pilot, invite yourself, add a seeded family to the pilot from Customers, sign in as that family and use the Feedback button.

## Known gaps / open items

- **Staging**: not connected yet. Open: the regression suite and load test on staging, the Supabase Security/Performance Advisor on the hosted project, the PITR restore drill, and the runbook dry run.
- Real-device checks (iPhone/iPad Safari, Android, desktop Safari/Firefox).
- Lawyer review of the privacy policy, terms and retention period; publish the policies before launch.
- Roll the Stripe test key that was shared during development.
- "Multiple permissive policies" (performance) accepted for now.
- A price-change notice email for subscribers (California ARL) before the first price change (from Phase 9).
