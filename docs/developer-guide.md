# Developer guide

Start with `CLAUDE.md` (rules), then this guide, then the phase docs (`docs/phase-1.md` … `phase-10.md`) for the detail of each area.

## Architecture

- **Next.js App Router** (TypeScript strict). Server Components read; Server Actions mutate. Route groups: `(marketing)` public, `(auth)`, `(family)`, `(school)`, `admin` (separate layout and guard). The `proxy.ts` (formerly middleware) sets a per-request CSP nonce, refreshes the Supabase session and makes coarse redirects. It is **not** an authorization boundary.
- **Supabase**: Postgres with RLS on every table, Auth (password, magic link, Google, Apple, passkeys, TOTP MFA), Storage (`media` bucket), `pg_cron`. Business rules that must never be bypassed (pricing, allergy blocks, cutoffs, capacity, money movements, staff roles) live in **security-definer SQL functions** with `search_path = ''`, called from Server Actions.
- **Stripe**: Payment Element (cards, Link, wallets), Billing (plans), Invoicing (schools, card + ACH), webhooks (signed, idempotent via `stripe_events`). Amounts are always computed server-side.
- **Email**: `queue_email()` in SQL → `notifications_log` → `/api/cron/notifications` worker → React Email render → Resend (Mailpit locally). Supabase Auth emails use `supabase/templates/`.
- **Other services**: Upstash rate limiting (in-memory locally), Cloudflare Turnstile, Sentry (PII scrubbed).

```
Browser ──► proxy.ts (CSP, session) ──► Server Component (read, RLS as the user)
                                    └─► Server Action: guard → Zod → SQL function / RLS → audit
Stripe ──► /api/webhooks/stripe (signature, idempotent) ──► stripe_* SQL functions
Vercel Cron ──► /api/cron/* (bearer secret) ──► email worker, school invoices, payment health
pg_cron ──► expiry, auto-fill, week close, reminders, summaries, purges
```

## Data model and RLS

`docs/erd.md` (regenerate with `pnpm db:erd`). Key ideas:

- **Roles** live in `user_roles` (never user metadata), copied into the JWT by the Custom Access Token Hook and re-checked in SQL (`has_role`, `has_any_role_aal2`, `is_owner_aal2`). Staff policies require `aal = 'aal2'`.
- **Households** own children, addresses, carts, orders, subscriptions. `is_household_member()` gates family rows. Schools are `organizations` with classrooms and standing orders; `org_role()` gates them.
- **Money** is integer cents with a currency. **Order lines snapshot** name, price and allergens at purchase.
- **Soft delete** (`archived_at`) for anything an order references. Closed households (deleted accounts) are purged after the retention period.
- **Audit**: `audit_log` is append-only (no update/delete policies, not even for the owner). Admin actions write it through `adminAction`; triggers audit content and price changes.
- **Public data** is read through `*_public` views (security_invoker, function-backed, read-only) or anon `select` policies on published rows only.

Every new table: enable RLS in the same migration, write explicit policies, add pgTAP tests (right role can, other roles can't, anon can't). `supabase/tests/phase10.test.sql` fails if any table lacks RLS, any view is writable by API roles, or any foreign key lacks an index.

## Server Actions

Always use a wrapper; `tests/server-actions-guarded.test.ts` fails the build otherwise.

| Wrapper                                                                   | For           | Does                                                                      |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| `adminAction({ roles, stepUp?, action, schema, input, revalidate? }, fn)` | `/admin`      | staff role + AAL2 (+ fresh MFA if `stepUp`), rate limit, Zod, audit entry |
| `familyAction({ schema, input, limiter? }, fn)`                           | family pages  | signed-in parent, their household, rate limit, Zod                        |
| `schoolAction({ schema, input, adminOnly? }, fn)`                         | school portal | approved organization role, Zod                                           |

Inside, use the user's Supabase client so RLS applies. Use `createAdminClient()` (service role) only in server-only modules, with a comment saying why.

## How to add a content block

1. Add a `t("area.key", "Default text", "Label")` entry to the right registry (`lib/content/registry.ts`, `school-registry.ts`, `email-registry.ts`, `pilot-registry.ts`). Placeholders go in `{braces}`.
2. `pnpm content:seed` regenerates the block in `supabase/bootstrap.sql` (a unit test fails if you forget).
3. Read it with `const c = await getContent(); c.text("area.key", { name })` (or `c.group("area.")` for a client component).
4. Deploy, then run `pnpm db:bootstrap` on each environment: it adds the new key without touching anything the owner edited.

No customer-facing text in code: `lib/content/no-hardcoded-copy.test.ts` checks the family and public pages.

## How to add an email

1. Add a row to `email_templates` in a migration (subject, preheader, body as rich-text JSON, button label).
2. Add it to `lib/email/catalog.ts`: audience, category (`transactional` / `security` / `marketing` + topic), the `{{variables}}` it may use, which variable the button links to, and when it's sent. Add sample values.
3. Queue it from SQL with `queue_email(template, to, payload, dedupe_key, household, org, user)`. Use a dedupe key so retries never send twice.
4. If the payload needs turning into display values (ids → order lines, dates, money), add that to `lib/email/vars.ts`.
5. Preview it in Admin → Content → Emails; check light and dark mode.

## Local development

```bash
pnpm install
```

```bash
pnpm exec supabase start
```

```bash
pnpm dev
```

`supabase db reset` applies migrations, then `bootstrap.sql` (reference data and copy), then `seed.sql` (demo menu, families, a school, staff with TOTP). Mailpit (local inbox) is at http://127.0.0.1:54324. Without real Stripe keys, payments run in mock mode.

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:test`, `pnpm build`, `pnpm test:e2e`. Load: `pnpm load:cutoff`. See `docs/qa.md`.

## Deployment

Vercel builds every push; previews use staging Supabase and Stripe test keys; production deploys from `main`. Database changes are migrations only (`supabase db push`), never edits in the dashboard. After deploying: `pnpm db:bootstrap` (new copy keys). Full checklist: `docs/go-live.md`.

## Incident response

1. **Contain**: Admin → Settings → ordering off (with a message), or roll back the Vercel deployment (Instant Rollback). For a suspected account compromise: revoke the staff role, sign the user out everywhere (Supabase → Auth → user → sign out), rotate any exposed key.
2. **Assess**: Sentry (errors), Vercel logs, Supabase logs, `audit_log` (who changed what, with before/after), `notifications_log` (what emails went out; addresses are hashed), Stripe dashboard and `stripe_events`.
3. **Fix** on a branch with a test that reproduces the problem; deploy through CI.
4. **Recover data** if needed: PITR restore (see `docs/go-live.md` §6). Stripe is the source of truth for money; the daily payment health check flags mismatches.
5. **Notify**: Hannah first. If personal information was exposed, California's breach notification law may require telling affected families; talk to a lawyer.
6. **Write up**: what happened, impact, fix, and the test that now guards it.
