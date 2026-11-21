# CLAUDE.md — Smart Cookie Enterprise Ordering Platform

Claude Code reads this file at the start of every session. Every phase prompt assumes it exists.

## 1. What we are building

Smart Cookie is a private kids' chef service (owner: Hannah). It makes healthy, home-cooked meals for families and schools. Today ordering runs on a PDF form: families retype their details every week, many don't read the form, there is no online payment, and the owner stitches the separate PDF orders together by hand to plan the cooking.

We are building the **Enterprise** platform that replaces all of that:

- **Families** create an account, add their children (with allergies and dietary needs), browse a **rotating weekly menu**, and order meals for each child. They can pay **à la carte** (a one-time cart) or through a **subscription plan**, save favorites, and reorder with one tap.
- **Schools** get an organization portal with classrooms, standing bulk orders sized by headcount, drop-off at the school, and monthly invoicing.
- **The owner and staff** get a secure admin portal. The owner can edit **all** business content: menus, meals, images, prices, plans, delivery zones, site text, FAQs, policies and email copy. Kitchen and ops staff see what their role needs. A chef dashboard shows the week's orders, the aggregated cook list, allergy flags, a dietary roll-up, payment status, labels and packing lists.

**Guiding principle:** the owner must never need a developer to change anything a customer sees. If it is text, an image, a price, a menu item, a plan, a fee or a date, it lives in the database and is editable in `/admin`.

## 2. Users and roles

| Role | Scope | Notes |
|---|---|---|
| `parent` | Their own household | Default role on sign-up. Manages children, orders, subscriptions and payment methods. |
| `school_admin` | Their own organization | Manages classrooms, standing orders and invoices. Can invite `school_staff`. |
| `school_staff` | Their own organization, read and limited order edits | Optional. |
| `kitchen` | Admin: cook list, labels, packing, allergy flags (read-only) | **No** prices, customer PII beyond child first name/classroom/allergies, or payments. |
| `ops` | Admin: orders, customers, schools, delivery, refunds up to a limit | Cannot change prices, plans, staff roles or site settings. |
| `owner` | Everything | Hannah. At least one owner must always exist. Only an owner can grant or revoke staff roles. |

Children **never** have accounts. Parents enter child data on their behalf.

## 3. Tech stack (verify current stable versions before installing — do not trust memory)

- **Framework:** Next.js (App Router, latest stable), React Server Components, Server Actions, TypeScript `strict`.
- **UI:** Tailwind CSS + shadcn/ui + lucide-react. Mobile-first: most parents will order from a phone. The app is a PWA (installable, manifest, icons).
- **Backend:** Supabase: Postgres, Auth, Storage, Row Level Security, database functions, `pg_cron` for scheduled jobs.
- **Auth:** Supabase Auth via `@supabase/ssr` (PKCE, httpOnly cookie sessions). Providers: Google OAuth, Sign in with Apple, email magic link, passkeys (WebAuthn), and email + password. TOTP MFA.
- **Payments:** Stripe: Checkout / Payment Element with **Link**, Billing (subscriptions), Invoicing (schools), Customer Portal, Tax (optional), webhooks.
- **Email:** Resend + React Email.
- **Validation:** Zod on every boundary (forms, server actions, route handlers, webhooks, env vars).
- **Bot protection:** Cloudflare Turnstile on sign-up, sign-in, magic-link request and password reset.
- **Rate limiting:** Upstash Redis (`@upstash/ratelimit`), or a Postgres-backed limiter if Upstash isn't wanted.
- **Observability:** Sentry (errors + performance), with PII scrubbing.
- **Testing:** Vitest (unit), Playwright (e2e), pgTAP or SQL tests for RLS policies.
- **Hosting:** Vercel (preferred) or Netlify. Supabase cloud. Separate **dev / staging / production** Supabase projects and Stripe test vs live keys.
- **Package manager:** pnpm.

## 4. Repository conventions

```
/app
  /(marketing)        public pages, all text pulled from CMS
  /(auth)             sign-in, sign-up, callback, MFA, reset
  /(family)           /account, /menu, /cart, /checkout, /orders, /favorites, /subscription, /children
  /(school)           /school/... organization portal
  /admin              owner/staff portal (separate layout, separate guard)
  /api/webhooks/stripe
/components           shared UI (ui/ = shadcn)
/lib
  /supabase           server, client, admin (service-role, server-only) clients
  /auth               guards: requireUser, requireRole, requireAAL2
  /stripe             server-only Stripe helpers
  /validation         zod schemas
  /content            CMS getters with caching + revalidation tags
/emails               React Email templates (copy pulled from DB)
/supabase
  /migrations         every schema change is a migration; never edit prod by hand
  /seed.sql
  /tests              RLS tests
/e2e                  Playwright
```

- All money is stored as **integer cents** with a `currency` column (default `usd`). Never use floats for money.
- All timestamps are `timestamptz`. The business timezone is `America/Los_Angeles`, stored in `site_settings`. Cutoffs and delivery days are computed in the business timezone.
- Every order line stores a **snapshot** of name, price and allergens at the moment of purchase, so later menu edits never rewrite history.
- Soft-delete (`archived_at`) for menu items, plans, zones and content. Never hard-delete anything an order references.
- Use server components for reads and server actions for mutations. Every server action: (1) authenticates, (2) authorizes by role, (3) validates with Zod, (4) relies on RLS as the final gate, (5) writes an audit log entry if it is an admin action.
- `import 'server-only'` in any module that touches the service-role key, Stripe secret or Resend key.

## 5. Security non-negotiables (apply to every phase)

1. **RLS on every table**, enabled in the migration that creates it, with explicit policies. No table is reachable with the anon key unless that is deliberate (e.g. published menu, published CMS content).
2. **The service-role key never reaches the browser.** It is used only in server-only modules, for webhooks and admin jobs, and every use is commented with *why*.
3. **Roles live in a `user_roles` table**, not in user-editable metadata. Role claims are added to the JWT via a Supabase **Custom Access Token Hook** and re-checked in RLS with a `has_role()` SQL function (`security definer`, `search_path` pinned).
4. **Admin requires MFA (AAL2).** Any account with `owner`, `ops` or `kitchen` must enroll TOTP (passkey as a second factor is optional), and every admin RLS policy checks `auth.jwt()->>'aal' = 'aal2'`. Middleware redirects AAL1 staff to an MFA challenge.
5. **Step-up re-authentication** (a fresh MFA challenge within the last 5 minutes) for sensitive admin actions: changing prices or plans, issuing refunds, changing staff roles, editing payout or tax settings, exporting customer data.
6. **Audit log**: an append-only `audit_log` table (who, role, action, entity, before/after JSON diff, IP, user agent, timestamp). Written by triggers or server actions; no update or delete policy for anyone, not even the owner.
7. **Auth hardening:** email verification required; passwords at least 12 characters, checked against leaked-password lists (enable Supabase's HaveIBeenPwned check); generic error messages (no account enumeration); Turnstile plus rate limits on all auth endpoints; short access-token lifetime with refresh-token rotation and reuse detection; sign-out invalidates all sessions on password change or MFA change; OAuth redirect URLs allow-listed per environment; Apple and Google identities linked to an existing account only after verified-email match.
8. **Stripe:** webhook signatures verified; events processed **idempotently** (store `event.id`); prices and totals computed **server-side only**; never trust client amounts; Stripe Prices are immutable, so a price change creates a new Price and archives the old one.
9. **HTTP security headers:** strict CSP (nonce-based for scripts; allow Stripe, Supabase, Turnstile, Sentry only), HSTS, X-Frame-Options DENY (except where Stripe requires), Referrer-Policy, Permissions-Policy.
10. **Uploads:** images only (JPEG/PNG/WebP/AVIF), with server-side magic-byte sniffing, a size cap (e.g. 8 MB), EXIF stripped, randomized filenames, and Storage bucket policies so only `owner` (and `ops` if allowed) can write.
11. **Child data minimization:** store a child's first name, last initial, optional grade or classroom, allergies, dietary preferences and notes. No birthdates, photos or full surnames. Allergy and dietary data is treated as sensitive: visible only to the household, to the school only for children enrolled through it, and to kitchen staff for fulfillment. Provide account deletion and data export (CCPA). Note COPPA: the service is directed at parents, not children.
12. **Secrets** live in env vars validated by Zod at boot; `.env*` is git-ignored; `.env.example` is committed with dummy values.
13. **Dependencies:** `pnpm audit` in CI; Dependabot or Renovate enabled; no unmaintained auth libraries.

## 6. Allergy safety rules (business-critical)

- Every menu item lists the **allergens it contains** (top 9 US allergens: milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame, plus owner-defined custom allergens) and **may-contain / shared-equipment** warnings.
- When a parent assigns a meal to a child whose profile lists a matching allergen, the app **blocks** the assignment with a clear explanation. Only an `owner` can mark a specific child/item combination as an approved exception (audited).
- Checkout ends with an **allergy confirmation step** ("Are these still correct for each child?"), as the proposal requires. On a returning order it is a one-tap confirmation, not a re-entry.
- Allergy flags appear in red on every kitchen view, label and packing list.
- An owner-editable allergen disclaimer is shown at checkout and on the menu. The app never promises "allergen-free".

## 7. Definition of done (for every phase)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` and the relevant Playwright specs all pass.
- New tables have RLS policies **and** RLS tests proving that (a) the right role can, (b) other roles cannot, and (c) anon cannot.
- No secrets in client bundles (check with `next build` output and a grep for key prefixes).
- Mobile layout checked at 375px width.
- Accessibility: keyboard navigable, labeled inputs, contrast AA, focus states.
- Write a short `docs/phase-N.md`: what was built, how to test it, known gaps.
- **Stop and report** at the end of each phase. Don't start the next phase until I say so.

## 8. Working rules for Claude Code

- Before installing or configuring any library (Supabase Auth features, passkeys, Stripe APIs, Next.js APIs), **check the current official docs**. APIs change; do not rely on memory.
- Ask me before: adding a paid service, changing the stack, weakening any rule in §5 or §6, or running anything against production.
- Prefer boring, well-documented solutions over clever ones.
- Commit after each working step with clear messages.
