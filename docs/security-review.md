# Security review (Phase 10, pre-launch)

Reviewed 2026-11-25 against the code on this branch, before any real customer uses the app. Every item is **fixed**, **accepted risk** (with the reason), or **open** (needs staging or the owner). There are **no open high or critical items**.

## Findings

| ID    | Severity           | Finding                                                                                                                                                                                                                                                                                                                                                                                       | Status                                                                                                                                                                                                                                                                                                                       |
| ----- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SR-01 | **Critical**       | The public projection views (`content_blocks_public`, `pages_public`, `site_settings_public`) ran with their owner's rights, and Supabase's default privileges gave `anon`/`authenticated` INSERT/UPDATE/DELETE on them. Simple views are auto-updatable, so **anyone with the public API key could rewrite published site copy and policy pages** (verified with a `PATCH` to the REST API). | **Fixed** (`20261129000100_hardening.sql`): each view now reads from a security-definer function (function-backed views can't be updated) and is `security_invoker`; writes are revoked on every public view. pgTAP `phase10` asserts no view is writable by API roles and none is security-definer; e2e repeats the attack. |
| SR-02 | Medium             | `pilot_code_is_valid` was executable by `anon`, so invite codes could be guessed through the API, skipping the app's Turnstile and rate limit.                                                                                                                                                                                                                                                | **Fixed**: service-role only; sign-up checks the code server-side after Turnstile + rate limit.                                                                                                                                                                                                                              |
| SR-03 | Low                | Same-site link check accepted `/\host`, which browsers treat as `//host` (an off-site link) in CMS rich text, CMS buttons and the announcement banner.                                                                                                                                                                                                                                        | **Fixed**: one shared `safeHref` rejects `//`, `/\` and control characters; sanitizer tests.                                                                                                                                                                                                                                 |
| SR-04 | Medium (privacy)   | Deleting an account removed the login but left the household's children, allergies and addresses behind indefinitely.                                                                                                                                                                                                                                                                         | **Fixed**: the last member leaving closes the household and archives its children at once; a monthly job deletes children (and their allergies), addresses, favourites and saved orders after the retention period (Settings → Privacy, default 24 months). Orders stay as financial records. pgTAP + e2e.                   |
| SR-05 | Medium (privacy)   | The CCPA data export still only covered Phase 2 tables (no children, allergies, orders, plans).                                                                                                                                                                                                                                                                                               | **Fixed**: export covers every family table; e2e downloads and checks it. Deletion is refused while a plan is still billing.                                                                                                                                                                                                 |
| SR-06 | Info               | 63 foreign keys had no covering index; `auth_attempts` had no primary key (Supabase Performance Advisor).                                                                                                                                                                                                                                                                                     | **Fixed** (indexes + PK); pgTAP asserts every FK stays indexed.                                                                                                                                                                                                                                                              |
| SR-07 | Info (performance) | 48 "multiple permissive policies" warnings: tables with a "members read their own" policy plus a "staff read all (AAL2)" policy.                                                                                                                                                                                                                                                              | **Accepted**: Postgres ORs them, which costs a little per query. Merging them would make the RLS harder to review, and the cutoff-rush load test (200 concurrent orders) stays under target. Revisit if tables grow large.                                                                                                   |
| SR-08 | Info               | `auth_attempts`, `deep_link_tokens`, `known_devices` have RLS on with no policies (advisor: "RLS enabled, no policy").                                                                                                                                                                                                                                                                        | **Accepted (intended)**: service-role only by design.                                                                                                                                                                                                                                                                        |
| SR-09 | Low                | After "sign out everywhere" (or a password change), an already-issued access token stays valid until it expires.                                                                                                                                                                                                                                                                              | **Accepted**: access tokens last 15 minutes (`jwt_expiry = 900`), refresh tokens rotate with reuse detection, and admin pages re-read roles from the database on every request.                                                                                                                                              |
| SR-10 | Low                | `minimatch` (dev-only, via the shadcn CLI) had a moderate ReDoS advisory.                                                                                                                                                                                                                                                                                                                     | **Fixed** with a pnpm override; `pnpm audit` reports no vulnerabilities.                                                                                                                                                                                                                                                     |
| SR-11 | —                  | Supabase Security/Performance Advisor on **staging**; PITR restore test.                                                                                                                                                                                                                                                                                                                      | **Open (staging)**: run when staging is connected (see go-live runbook).                                                                                                                                                                                                                                                     |

## 1. RLS audit

Every table in `public` has RLS enabled (pgTAP `phase10` fails if one doesn't). Policies are tested per role in `supabase/tests/*.sql` (403 tests): the right role can, other roles can't, anon can't.

| Table                        | RLS | Policies | Anon can |
| ---------------------------- | --- | -------- | -------- |
| `account_credits`            | on  | 2        | —        |
| `addresses`                  | on  | 2        | —        |
| `allergens`                  | on  | 3        | SELECT   |
| `allergy_conflict_alerts`    | on  | 1        | —        |
| `allergy_overrides`          | on  | 3        | —        |
| `audit_log`                  | on  | 1        | —        |
| `auth_attempts`              | on  | 0        | —        |
| `carts`                      | on  | 1        | —        |
| `child_allergens`            | on  | 2        | —        |
| `children`                   | on  | 5        | —        |
| `classroom_allergy_counts`   | on  | 4        | —        |
| `classrooms`                 | on  | 3        | —        |
| `content_blocks`             | on  | 2        | —        |
| `content_versions`           | on  | 2        | —        |
| `customer_notes`             | on  | 2        | —        |
| `deep_link_tokens`           | on  | 0        | —        |
| `deliveries`                 | on  | 2        | —        |
| `delivery_zones`             | on  | 3        | SELECT   |
| `dietary_badges`             | on  | 3        | SELECT   |
| `discount_codes`             | on  | 2        | —        |
| `email_preferences`          | on  | 3        | —        |
| `email_templates`            | on  | 2        | —        |
| `faqs`                       | on  | 3        | SELECT   |
| `favorites`                  | on  | 1        | —        |
| `feedback`                   | on  | 4        | —        |
| `funnel_events`              | on  | 1        | —        |
| `household_members`          | on  | 3        | —        |
| `households`                 | on  | 3        | —        |
| `invoice_lines`              | on  | 2        | —        |
| `invoices`                   | on  | 2        | —        |
| `known_devices`              | on  | 0        | —        |
| `late_order_exceptions`      | on  | 2        | —        |
| `media`                      | on  | 2        | —        |
| `menu_categories`            | on  | 3        | SELECT   |
| `menu_item_allergens`        | on  | 3        | SELECT   |
| `menu_item_badges`           | on  | 3        | SELECT   |
| `menu_item_images`           | on  | 3        | SELECT   |
| `menu_item_price_history`    | on  | 1        | —        |
| `menu_items`                 | on  | 3        | SELECT   |
| `menu_template_items`        | on  | 2        | —        |
| `menu_templates`             | on  | 2        | —        |
| `menu_week_items`            | on  | 3        | SELECT   |
| `menu_weeks`                 | on  | 3        | SELECT   |
| `notifications_log`          | on  | 1        | —        |
| `order_items`                | on  | 1        | —        |
| `order_payments`             | on  | 1        | —        |
| `order_refunds`              | on  | 2        | —        |
| `orders`                     | on  | 2        | —        |
| `organizations`              | on  | 4        | —        |
| `pages`                      | on  | 2        | —        |
| `pilot_invites`              | on  | 1        | —        |
| `plan_price_history`         | on  | 1        | —        |
| `plans`                      | on  | 3        | SELECT   |
| `prep_checks`                | on  | 3        | —        |
| `profiles`                   | on  | 3        | —        |
| `saved_orders`               | on  | 1        | —        |
| `school_closures`            | on  | 1        | —        |
| `site_settings`              | on  | 2        | —        |
| `standing_order_adjustments` | on  | 1        | —        |
| `standing_orders`            | on  | 3        | —        |
| `stripe_events`              | on  | 1        | —        |
| `subscription_allowances`    | on  | 1        | —        |
| `subscriptions`              | on  | 1        | —        |
| `testimonials`               | on  | 3        | SELECT   |
| `user_roles`                 | on  | 4        | —        |
| `zone_waitlist`              | on  | 3        | —        |

Anonymous access is deliberate only for the published menu, plans, delivery zones, FAQs and testimonials, plus the read-only public views (`content_blocks_public`, `pages_public`, `site_settings_public`), which expose published values only (never drafts).

**Advisors (local run, `supabase db advisors`)**: after the fixes, the only remaining items are SR-07 (accepted) and SR-08 (intended). `security_definer_view` (4 errors) and `unindexed_foreign_keys` (63) are gone.

## 2. Authorization sweep

- `tests/server-actions-guarded.test.ts` reads every `"use server"` file and fails if any exported action doesn't start with a guard (`adminAction`, `familyAction`, `schoolAction`, `authorizeStaffChange`, `requireUser`/`getUser`, or the auth forms' Turnstile + rate-limit `preflight`). Public actions are listed with how they're protected. 128 actions checked.
- Every wrapper validates input with Zod; unknown keys are stripped (Zod objects aren't passthrough), so extra fields in action input are ignored (mass assignment). The database is the final gate: column grants and RLS (e2e: a parent can't set `stripe_customer_id`, insert orders directly, or grant themselves a role).
- Route handlers: Stripe webhook (signature), cron routes (bearer secret), `/api/unsubscribe` (random token, rate-limited, only opts out), `/account/privacy/export` (signed-in user, RLS), `/admin/kitchen-export` (staff guard), `/auth/*` (Supabase PKCE/OTP verification), `/api/health` (no data).

## 3. OWASP Top 10 / ASVS L2

| Check            | Result                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IDOR             | e2e `security.spec.ts`: a parent can't read or change another household's orders, items, children, allergies or addresses through the API; the order page for someone else's order is a 404.                                                                                                                                                                                                     |
| Mass assignment  | Zod strips unknown keys; column grants + RLS block server-owned fields (e2e).                                                                                                                                                                                                                                                                                                                    |
| XSS              | Rich text is sanitized server-side against an allow-list and rendered as React elements, never HTML (`lib/validation/rich-text.test.ts`: script/HTML nodes, event-handler attributes, `javascript:`/`data:`/`//`/`/\` links). Email variables are escaped and allow-listed per template (`lib/email/templates.test.ts`). Nonce-based CSP with `strict-dynamic` (e2e `security-headers.spec.ts`). |
| CSRF             | Server Actions only accept same-origin requests (Next.js compares `Origin` with `Host`; `serverActions.allowedOrigins` is not widened). Session cookies are `SameSite=Lax`. State-changing route handlers authenticate with a signature, bearer secret or one-purpose token, not cookies.                                                                                                        |
| SSRF             | No server-side fetch uses a user-supplied URL (only Turnstile, Stripe, Resend/Mailpit and Supabase, all fixed hosts).                                                                                                                                                                                                                                                                            |
| Open redirects   | `safeNext` allows same-site paths only; e2e tries `https://`, `//`, `/\` and `javascript:`.                                                                                                                                                                                                                                                                                                      |
| Clickjacking     | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` (tested).                                                                                                                                                                                                                                                                                                                                 |
| File uploads     | Images only, magic-byte sniffing, 8 MB cap, EXIF stripped, random names, owner-only bucket writes (Phase 4; e2e rejects a renamed `.exe`).                                                                                                                                                                                                                                                       |
| Injection        | All SQL is parameterized (PostgREST/RPC); dynamic SQL in migrations uses `format('%I')`. Email subjects are single-line (no header injection).                                                                                                                                                                                                                                                   |
| Security logging | Append-only `audit_log` (no update/delete for anyone); Sentry with PII scrubbing (`lib/observability/scrub.test.ts`).                                                                                                                                                                                                                                                                            |

## 4. Authentication

| Check                      | Evidence                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brute force / rate limits  | Turnstile + 5/min/IP on every auth form, per-email limits on magic links/resets, account lockout counters (`auth_attempts`); e2e: the sixth wrong password in a minute is refused with the generic message. |
| Account enumeration        | Same generic message for unknown email / wrong password / unconfirmed (e2e).                                                                                                                                |
| Magic-link reuse           | Single-use: e2e opens the link twice, the second goes to `/sign-in?error=link`.                                                                                                                             |
| Session revocation         | "Sign out everywhere" revokes refresh tokens (`scope: global`); password/MFA change notifications on; SR-09.                                                                                                |
| Admin AAL2 in the database | Every staff RLS policy checks `aal = 'aal2'`; pgTAP calls them with AAL1 claims and is refused (identity, phase3–9 tests).                                                                                  |
| Last owner                 | The database refuses to remove the last owner (pgTAP identity).                                                                                                                                             |
| Step-up                    | Prices, plans, refunds, staff roles, tax/payment settings need an MFA check within 5 minutes (e2e + database triggers).                                                                                     |
| OAuth                      | `@supabase/ssr` PKCE (code verifier cookie, server-side exchange); identities link only on verified email. Redirect URLs are allow-listed per environment in Supabase (go-live checklist).                  |
| Passwords                  | 12+ characters, letters and digits, HaveIBeenPwned check, email verification required.                                                                                                                      |

## 5. Secrets

- `gitleaks` scans the **full git history** in CI (`.gitleaks.toml` allow-lists only the public local-stack keys and CI placeholders). A local pattern scan of every commit found no real keys.
- Client bundles: `next build` output grepped for `sb_secret_`, `sk_live`/`sk_test`, `rk_`, `whsec_`, `re_`, `service_role`, `CRON_SECRET`: no secrets (only the supabase-js prefix check string).
- **Rotate before production**: the Stripe test key used during development was shared in a chat; roll it in the Stripe dashboard. Production uses new keys for everything (Supabase, Stripe live, Resend, Upstash, Turnstile, Sentry, `CRON_SECRET`).

## 6. Dependencies

`pnpm audit`: no known vulnerabilities (after SR-10). CI fails on high/critical (`pnpm audit --audit-level=high`). Lockfile committed; Dependabot configured (Phase 1).

## 7. Backups and recovery

See `docs/go-live.md` §Backups: enable PITR on production (Supabase Pro + PITR add-on) or at least daily backups; the restore drill into staging is **open** until staging is connected (SR-11).

## 8. Privacy

Privacy policy and terms: drafts in `supabase/bootstrap.sql` (unpublished, marked for lawyer review). CCPA export/delete: fixed and tested (SR-04, SR-05). Retention: closed accounts' child data deleted after the owner's retention period (default 24 months); recipient emails in the email log are hashed once sent. See `docs/compliance.md`.

## 9. Monitoring

- `/api/health` (200 when the database answers, 503 otherwise) for an uptime monitor.
- Daily payment health job (`/api/cron/payment-health`): orders stuck in `pending_payment`, Stripe-paid-but-not-marked orders, failed Stripe events, emailed to the owner.
- Owner payments summary (daily) and cutoff digest (Phase 9).
- Sentry alerts and Stripe webhook failure emails are configured in those dashboards (go-live checklist).
