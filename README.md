# Smart Cookie

Ordering platform for Smart Cookie, a private kids' chef service: families order weekly meals per child, schools place standing classroom orders, and the owner and staff run everything from a secure admin portal.

The product spec, security rules and conventions live in [`CLAUDE.md`](./CLAUDE.md). Per-phase notes are in [`docs/`](./docs).

## Stack

Next.js 16 (App Router, React Server Components, Server Actions, TypeScript strict) · Tailwind CSS v4 + shadcn/ui + lucide-react · Supabase (Postgres, Auth, Storage, RLS) · Stripe · Resend · Upstash Redis · Cloudflare Turnstile · Sentry · Vitest + Playwright · pnpm.

## Local setup

Requirements: Node.js 22+, pnpm 10 (`corepack enable`), and Docker (for the local Supabase stack).

```bash
pnpm install
cp .env.example .env.local      # dummy values work for the UI shells
pnpm db:start                   # starts local Supabase in Docker
pnpm supabase status            # copy API URL + publishable/secret keys into .env.local
pnpm dev                        # http://localhost:3000
```

Emails (confirmations, magic links, invites) land in Mailpit at <http://127.0.0.1:54324>.

**Seed data (local only):** `pnpm db:reset` loads test accounts for every role (password `SmartCookie-local-2026!`), a sample menu, plans, zones and a school. The full list is in [`docs/phase-3.md`](./docs/phase-3.md). Staff accounts have TOTP pre-enrolled with the local-only secret `JBSWY3DPEHPK3PXP`.

**First owner:** sign up at `/sign-up`, confirm the email, then run `pnpm owner:bootstrap you@example.com` and visit `/admin`. You'll be asked to set up an authenticator app. Further staff are invited from `/admin/staff`.

`pnpm dev` and `pnpm build` **refuse to start** if any required environment variable is missing or malformed. The error lists the variable names (never their values).

## Environment variables

Every variable is documented, with a correctly formatted dummy value, in [`.env.example`](./.env.example). Validation lives in `lib/env.schema.ts`.

| Variable                                              | Exposure             | Purpose                                                                                                               |
| ----------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_ENV`                                 | public               | `development` / `staging` / `production`. Production requires Stripe **live** keys; all others require **test** keys. |
| `NEXT_PUBLIC_SITE_URL`                                | public               | Canonical site URL (auth redirects, emails).                                                                          |
| `NEXT_PUBLIC_SUPABASE_URL`                            | public               | Supabase project URL.                                                                                                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                | public               | Supabase publishable key (formerly "anon"). RLS-restricted.                                                           |
| `SUPABASE_SECRET_KEY`                                 | **server only**      | Supabase secret key (formerly "service_role"). Bypasses RLS; see `lib/supabase/admin.ts`.                             |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`                  | public               | Stripe publishable key.                                                                                               |
| `STRIPE_SECRET_KEY`                                   | **server only**      | Stripe secret (or restricted) key.                                                                                    |
| `STRIPE_WEBHOOK_SECRET`                               | **server only**      | Verifies Stripe webhook signatures.                                                                                   |
| `RESEND_API_KEY`                                      | **server only**      | Transactional email.                                                                                                  |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                      | public               | Cloudflare Turnstile widget.                                                                                          |
| `TURNSTILE_SECRET_KEY`                                | **server only**      | Turnstile server-side verification.                                                                                   |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | **server only**      | Rate limiting.                                                                                                        |
| `NEXT_PUBLIC_SENTRY_DSN`                              | public               | Sentry DSN (not a secret by design).                                                                                  |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`   | build only, optional | Source-map upload.                                                                                                    |

Server-only values are read through `lib/env.ts`, which imports `server-only`, so importing it from client code fails the build. `.env*` files are git-ignored except `.env.example`.

## Scripts

| Script                                   | What it does                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                               | Dev server (Turbopack).                                                       |
| `pnpm build` / `pnpm start`              | Production build / serve it.                                                  |
| `pnpm typecheck`                         | Generate route types, then `tsc --noEmit`.                                    |
| `pnpm lint`                              | ESLint (zero warnings allowed).                                               |
| `pnpm format` / `pnpm format:check`      | Prettier (with Tailwind class sorting).                                       |
| `pnpm test`                              | Vitest unit tests.                                                            |
| `pnpm test:e2e`                          | Playwright against a production build (run `pnpm build` first).               |
| `pnpm audit`                             | `pnpm audit --audit-level=high`.                                              |
| `pnpm db:start` / `db:stop` / `db:reset` | Local Supabase stack; `db:reset` re-applies migrations + `supabase/seed.sql`. |
| `pnpm db:test`                           | Database (RLS) tests in `supabase/tests`.                                     |
| `pnpm icons`                             | Re-render PWA icons from `app/icon.svg`.                                      |

Playwright needs the local Supabase stack running (`pnpm db:start`) with its keys in `.env.local`. For Playwright locally you can reuse an installed Chromium: `PW_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e`. Otherwise run `pnpm exec playwright install chromium` once.

## Environments and deployment

Three fully separate environments. Each has its own Supabase project, Stripe mode and secrets:

| Environment     | Supabase project                                 | Stripe        | Deployed from                                             |
| --------------- | ------------------------------------------------ | ------------- | --------------------------------------------------------- |
| **development** | local (`supabase start`) or a shared dev project | test keys     | your machine; Vercel **preview** deployments for every PR |
| **staging**     | `smartcookie-staging`                            | test keys     | `main` branch → staging domain                            |
| **production**  | `smartcookie-prod`                               | **live** keys | promoted from staging (manual)                            |

Flow: **PR → preview deploy → merge to `main` → staging → manual promotion → production.**

1. **Pull request.** CI runs typecheck, lint, format check, unit tests, `pnpm audit`, build, a secrets-in-bundle check and Playwright. Vercel builds a preview deployment against the dev Supabase project and Stripe test keys.
2. **Merge to `main`.** Vercel deploys to staging. Apply migrations to staging with `pnpm supabase link --project-ref <staging-ref>` then `pnpm supabase db push`.
3. **Promote to production** after checking staging: push migrations to the production project the same way (linked to `<prod-ref>`), then promote the staging build in Vercel.

Rules:

- Schema changes **only** via `supabase/migrations`. Never edit a hosted database by hand.
- Nothing runs against production without the owner's explicit go-ahead (CLAUDE.md §8).
- Each Vercel environment (Preview / Staging / Production) holds its own env vars; production alone gets live Stripe keys and `NEXT_PUBLIC_APP_ENV=production`, and the build refuses a mismatch.
- OAuth redirect URLs are allow-listed per Supabase project. See the provider checklist in [`docs/phase-2.md`](./docs/phase-2.md).

## Security baseline

- Nonce-based Content Security Policy per request (`proxy.ts`, `lib/security/csp.ts`), plus HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` (`lib/security/headers.ts`). Asserted by `e2e/security-headers.spec.ts`.
- Supabase sessions use httpOnly cookies via `@supabase/ssr`; the proxy refreshes them on each request.
- Sentry events, breadcrumbs and spans are PII-scrubbed (`lib/observability/scrub.ts`), including anything under `children` / `allergies`.
- Named rate limiters in `lib/ratelimit.ts` (identifiers are hashed before reaching Redis).

See CLAUDE.md §5 for the full list of non-negotiables.
