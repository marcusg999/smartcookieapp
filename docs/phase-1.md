# Phase 1: Foundation, environments and security baseline

## What was built

| Task                                                                                                                                                                                                | Where                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Next.js 16.4 (App Router, TS strict, Tailwind v4, ESLint), pnpm, Prettier (+ Tailwind plugin), shadcn/ui (manual setup) and lucide-react                                                            | `package.json`, `components.json`, `components/ui/*`                                       |
| Route groups and four layouts: marketing, family (`/account`, `/menu`, `/cart`, …), school (`/school/...`), admin (`/admin/...`, own sidebar shell), plus an auth layout                            | `app/(marketing)`, `app/(family)`, `app/(school)`, `app/admin`, `app/(auth)`               |
| Zod env validation that fails `next dev` / `next build`, `.env.example` with every variable                                                                                                         | `lib/env.schema.ts`, `lib/env.ts` (server-only), `lib/env.public.ts`, `next.config.ts`     |
| Supabase clients: server (cookies via `@supabase/ssr`), browser, admin (service role, `server-only`); Supabase CLI config, migrations/tests folders, seed                                           | `lib/supabase/*`, `supabase/`                                                              |
| Proxy (Next 16's renamed middleware): session refresh on each request + route-protection stub for Phase 2                                                                                           | `proxy.ts`, `lib/supabase/proxy.ts`                                                        |
| Security headers: per-request nonce CSP (Stripe, Supabase, Turnstile, Sentry, Vercel Analytics only), HSTS, `frame-ancestors 'none'` + `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy | `lib/security/csp.ts`, `lib/security/headers.ts`                                           |
| Sentry client + server + edge, PII scrubbing in `beforeSend`, `beforeBreadcrumb`, `beforeSendSpan`                                                                                                  | `instrumentation*.ts`, `sentry.*.config.ts`, `lib/observability/*`, `app/global-error.tsx` |
| Rate limiters `auth` 5/min/IP, `magicLink` 3/15 min/email, `checkout` 10/min/user, `adminMutation` 60/min/user                                                                                      | `lib/ratelimit.ts`                                                                         |
| PWA manifest + placeholder icons (generated from `app/icon.svg`)                                                                                                                                    | `app/manifest.ts`, `public/icons/*`, `scripts/generate-icons.mjs`                          |
| CI: install → typecheck → lint → format check → unit tests → `pnpm audit --audit-level=high` → build → secrets-in-bundle grep; Playwright job; Dependabot                                           | `.github/workflows/ci.yml`, `.github/dependabot.yml`                                       |
| Design tokens as CSS variables (warm placeholder palette, radius, fonts, red allergy token)                                                                                                         | `app/globals.css`                                                                          |
| README: local setup, env vars, scripts, deploy flow                                                                                                                                                 | `README.md`                                                                                |

## How to test

```bash
pnpm install
cp .env.example .env.local
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm test:e2e
```

Results at the end of this phase (run locally in the build container):

- `pnpm typecheck`: passes. `pnpm lint`: 0 errors., 0 warnings.
- `pnpm test`: 23 unit tests pass (env validation, CSP, PII scrubbing, rate-limit helpers).
- `pnpm test:e2e`: 30 Playwright tests pass on desktop Chrome and Pixel 7. They cover the four shells rendering, zero CSP violations in the browser console, no horizontal scroll at 375px, skip link, manifest and icons, a fresh nonce on every script per response, and every header that securityheaders.com grades.
- Removing any required variable makes `pnpm build` exit 1 with `Invalid or missing environment variables: - STRIPE_WEBHOOK_SECRET: …`.
- `pnpm audit --audit-level=high`: passes (1 moderate advisory, below the threshold).
- No server key prefixes (`sk_`, `whsec_`, `sb_secret_`, `re_`, Upstash token) appear in `.next/static`.

## Decisions to know about

1. **Cache Components is off.** Next.js 16's `create-next-app` enables `cacheComponents` (which implies Partial Prerendering). The bundled Next.js CSP guide says nonces need dynamic rendering and that **PPR is incompatible with nonce-based CSP**. CLAUDE.md §5.9 requires a nonce CSP, so every page renders per request (`await connection()` in the root layout). Cost: no static/CDN caching of HTML. If that ever matters, the alternative is Next's experimental hash-based SRI CSP. That would be a deliberate change to §5.9, so I'd ask first.
2. **`proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention. It runs on the Node.js runtime.
3. **Supabase key names follow the current docs**: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (replaces "anon key") and `SUPABASE_SECRET_KEY` (replaces "service-role key"). Legacy JWT-style anon/service_role keys are still accepted by the validator. Sessions are verified with `auth.getClaims()`; `getSession()` is never trusted on the server.
4. **Stripe key mode is enforced**: `NEXT_PUBLIC_APP_ENV=production` requires `sk_live_`/`pk_live_`; anything else requires test keys. A staging deploy can't charge real cards, and production can't silently run in test mode.
5. **CSP details.** `script-src` is `'self' 'nonce-…' 'strict-dynamic'` plus the allowed hosts; `'unsafe-eval'` is added in development only, as the Next docs require. `<style>` elements need the nonce. `style-src-attr 'unsafe-inline'` allows `style=""` attributes, which some UI primitives emit and which can't run script. `form-action` also allows Stripe Checkout and Billing so server-action redirects to hosted pages work. The Sentry ingest host is derived from the DSN rather than wildcarded.
6. **Sentry v11** removed `sendDefaultPii`; the new `dataCollection` options are set to collect nothing identifying. On top of that, a custom scrubber redacts emails, names, phone, address, notes, credentials and whole `children`/`allergies`/`dietary` subtrees from events, breadcrumbs and streamed spans. Session Replay is not enabled (PII risk).
7. **Rate-limit identifiers are SHA-256 hashed** before reaching Redis, so emails and IPs aren't stored in plain text.
8. **shadcn/ui was set up by hand** because the shadcn CLI needs `ui.shadcn.com`, which this build environment's network blocks. I used the components from the official shadcn GitHub repo (`button`, `card`, `separator`) and the current `cn` package. `pnpm dlx shadcn add <component>` works normally on a machine with open internet.
9. **No web fonts yet.** `next/font/google` downloads fonts at build time; the brand fonts come later. System font stacks are set through the `--font-sans` / `--font-display` tokens.

## Known gaps / needs from you

- **Three Supabase projects (dev / staging / production)** must be created in your Supabase account. I can't create cloud projects from here, and they may involve billing. The README documents the link/push flow. Local dev uses `supabase start`, which this build container couldn't run (no Docker daemon), so the local stack was configured but not booted here.
- **Vercel project and env vars** per environment, the Sentry project (DSN, auth token for source maps) and the Upstash database all need your accounts. Until then the dummy values in `.env.example` let the app build and run, and the rate limiter will error if actually called.
- **CI hasn't run on GitHub yet.** It runs once this branch's PR is updated; the same commands pass locally.
- **No service worker / offline mode.** The manifest makes the app installable; push notifications and offline support aren't in scope yet.
- Theme colour and manifest colours are hard-coded placeholders until branding moves into `site_settings`.
- `/menu` currently sits in the family route group. Phase 2's auth guard must keep the published menu public; it's linked from the marketing site.
