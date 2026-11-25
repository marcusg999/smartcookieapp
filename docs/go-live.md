# Go-live runbook

Do every step on **staging first** (the dry run), then repeat on production. Tick each box. Never run tests, seed data or the load test against production.

|                       | Staging                                         | Production                             |
| --------------------- | ----------------------------------------------- | -------------------------------------- |
| Supabase project      | `smartcookie-staging`                           | `smartcookie-prod` (Pro plan + PITR)   |
| Vercel                | Preview deployments + a `staging` branch domain | Production deployment, client's domain |
| Stripe                | Test mode keys                                  | Live mode keys                         |
| Email                 | Resend test domain (or no key: nothing is sent) | Resend, verified `mail.` subdomain     |
| `NEXT_PUBLIC_APP_ENV` | `staging`                                       | `production`                           |

## 1. Supabase project

- [ ] Create the project in the US West region. Turn on **Point-in-Time Recovery** (production; Pro plan + PITR add-on) or confirm daily backups.
- [ ] Link and push migrations (no seed data):
  ```bash
  pnpm exec supabase link --project-ref <ref>
  ```
  ```bash
  pnpm exec supabase db push
  ```
- [ ] Load reference data (allergens, badges, categories, all site copy, policy pages, starter FAQs). Safe to re-run after every deploy: it only adds new keys and never overwrites the owner's edits.
  ```bash
  SUPABASE_DB_URL='<direct connection string>' pnpm db:bootstrap
  ```
- [ ] Check `pg_cron` jobs exist (Database → Cron): expire-pending-orders, auto-fill, close-due-weeks, cutoff-reminders, renewal-reminders, owner summaries, school invoices, purge-closed-households.
- [ ] **Advisors**: Database → Advisors (Security and Performance). Expected: only the accepted "multiple permissive policies" and the three intended "RLS enabled, no policy" items (see `docs/security-review.md`). Anything else: stop and fix.
- [ ] Auth → Hooks: enable the **Custom Access Token Hook** (`public.custom_access_token_hook`).
- [ ] Auth → Settings: email confirmations on; secure password change on; minimum password length 12, letters + digits; leaked-password protection (HaveIBeenPwned) on; JWT expiry 900 s; refresh-token rotation on (reuse interval 10 s); MFA TOTP on; passkeys on.
- [ ] Auth → URL configuration: Site URL = the environment's URL. Redirect allow-list: only `https://<domain>/**` for that environment (no localhost in production).
- [ ] Auth → Providers: Google and Apple with **production** client IDs and secrets; their consoles list only this environment's callback URL (`https://<project>.supabase.co/auth/v1/callback`).
- [ ] Auth → SMTP: `smtp.resend.com`, port 465, user `resend`, password = a Resend API key, sender `hello@mail.<domain>`, name "Smart Cookie".
- [ ] Auth → Email templates: paste each file from `supabase/templates/` (confirmation, magic link, recovery, invite, email change) and turn on the security notifications (password changed, email changed, MFA added/removed, sign-in method linked/removed) with their templates.
- [ ] Storage: the `media` bucket and its policies come from migrations; check uploads work from Admin → Content → Media.
- [ ] Create the owner: sign up at `/sign-up` with Hannah's email, confirm it, then:
  ```bash
  NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SECRET_KEY=<secret> pnpm owner:bootstrap hannah@<domain>
  ```
  Hannah signs in, is sent to MFA enrollment, scans the QR code and saves the recovery codes.

## 2. Stripe (live mode for production)

- [ ] Products and prices are created **by the app** from Admin → Menu and Admin → Plans (don't copy them from test mode).
- [ ] Webhook endpoint `https://<domain>/api/webhooks/stripe`, API version `2026-11-18.endive`, events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `invoice.overdue`, `invoice.voided`, `invoice.marked_uncollectible`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
- [ ] Settings → Payment methods: Card, **Link**, Apple Pay, Google Pay, and US bank account (ACH, for school invoices). Register the domain under **Payment method domains** (Apple Pay verification).
- [ ] Customer Portal: allow updating payment methods and viewing invoices; cancellation is handled in the app (California auto-renewal rules), so turn portal cancellation off.
- [ ] Statement descriptor: `SMARTCOOKIE` (short, recognizable). Support email and phone.
- [ ] Tax: record the decision (flat rate, Stripe Tax, or none) in Admin → Settings → Tax after talking to the accountant.
- [ ] Email notifications for failed webhook deliveries are on (Developers → Webhooks → endpoint → alerts).
- [ ] **Roll the test secret key** that was shared during development (Developers → API keys).

## 3. Domain, HTTPS, email DNS

- [ ] The client owns the domain. Point the apex and `www` at Vercel; HTTPS is automatic. HSTS is sent by the app.
- [ ] Email: follow the deliverability checklist in `docs/phase-9.md` (Resend domain on `mail.<domain>`, SPF and DKIM records, DMARC `p=none` then `quarantine`).

## 4. Vercel

- [ ] Environment variables per environment (Production / Preview), validated at boot by `lib/env.schema.ts` (the app refuses to start in production with test keys, placeholders, `MAILPIT_URL`, `STEP_UP_MAX_AGE_SECONDS` or `AUTH_RATE_LIMIT_PER_MINUTE`):
      `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `CRON_SECRET` (32+ random characters).
- [ ] Preview deployments use the **staging** Supabase project and Stripe **test** keys. Staging also sets `AUTH_RATE_LIMIT_PER_MINUTE=300` so the regression suite can run.
- [ ] Crons (`vercel.json`): email worker every minute (Pro plan), school invoices daily, payment health daily. Each call carries `CRON_SECRET`.
- [ ] GitHub: create the `staging` environment for the **Staging regression** workflow (variables `STAGING_URL`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`; secrets `STAGING_SUPABASE_SECRET_KEY`, `STAGING_CRON_SECRET`).

## 5. Monitoring

- [ ] Uptime: an external monitor (e.g. Better Stack or UptimeRobot, free tiers) polls `https://<domain>/api/health` every minute and alerts Hannah and the developer by email/SMS on two failures.
- [ ] Sentry: alert rules for a new issue, an error spike (more than 10 events in 5 minutes), and slow transactions on `/checkout` and `/order`. PII scrubbing is on in the SDK.
- [ ] Stripe: webhook failure emails (step 2). The app's daily payment health check emails Hannah about stuck or mismatched payments.

## 6. Backups and the restore drill

- [ ] Production: PITR on (or daily backups). Note the retention window.
- [ ] Drill (staging, once before launch): create a test order, note the time, delete the order, then Database → Backups → restore to just before the deletion (PITR) or restore the latest daily backup into a **new** project. Check the order is back and the app works against the restored project. Write down how long it took.
- [ ] Restore procedure for a real incident: pause ordering (Admin → Settings → Ordering off), restore into a new project, point Vercel's Supabase env vars at it (or restore in place if the outage allows), re-run `pnpm db:bootstrap`, check `/api/health`, then turn ordering back on. Stripe stays the source of truth for payments: the payment health check flags anything that needs reconciling.

## 7. Owner content pass (Hannah, in Admin)

- [ ] Menu items with photos, allergens and may-contain, prices; templates and the first weeks; capacities.
- [ ] Plans and prices; delivery zones, fees, minimums, delivery days and windows.
- [ ] Settings: business details, logo and colours, cutoff rule, timezone, tax, refund limit, email timing, **mailing address** (required in optional emails), reply-to, data retention.
- [ ] Content: every page section, FAQs, testimonials (real ones only), the allergen disclaimer.
- [ ] Policies: have a lawyer review the **privacy policy** and **terms** drafts (Content → Pages), fill in the bracketed items, then publish them. Review the refund and allergy policies.
- [ ] Emails: read every email in Content → Emails and send a test to yourself.

## 8. Pilot (3–5 founding families)

- [ ] Admin → Pilot: turn **pilot mode on** (sign-up needs an invite code). Set the success targets.
- [ ] Invite the founding families by email from the Pilot page (or add existing families from their customer page).
- [ ] Week 1: they order live; Hannah cooks, labels and delivers as normal. Watch the Pilot page (funnel, feedback) and fix friction.
- [ ] Week 2: check the success criteria (reorder rate, repeat-order time, zero allergy incidents).

## 9. Launch

- [ ] Pilot criteria met. Admin → Pilot: turn pilot mode **off**.
- [ ] Announcement banner (Admin → Settings) for launch week.
- [ ] Email the families from the old PDF form an invitation to sign up (from Hannah's own email, with their consent to be contacted; not from the app's marketing lists).

## 10. Hypercare (2 weeks)

- [ ] Daily: Sentry issues, `/api/health` alerts, the payment health and payments summary emails, Pilot/feedback page, Stripe dashboard.
- [ ] After two quiet weeks: hand over `docs/owner-guide.md` and this runbook; agree how Hannah reports problems (see the owner guide).

## Dry run log (staging)

| Step                        | Date | Who | Result / notes |
| --------------------------- | ---- | --- | -------------- |
| 1 Supabase                  |      |     |                |
| 2 Stripe (test)             |      |     |                |
| 3 DNS / email               |      |     |                |
| 4 Vercel                    |      |     |                |
| 5 Monitoring                |      |     |                |
| 6 Restore drill             |      |     |                |
| 7 Content pass              |      |     |                |
| Regression suite on staging |      |     |                |
| Load test on staging        |      |     |                |
