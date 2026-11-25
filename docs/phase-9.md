# Phase 9: Transactional email

Every important moment now sends a branded email whose words the owner edits in **Admin → Content → Emails**. Locally (and in CI) mail goes to **Mailpit** (`http://127.0.0.1:54324`); once a Resend key and sending domain exist, the same code sends through **Resend**. Nothing about the queue, templates or tests changes at that point.

## What was built

### How an email is sent

1. **Something happens** (an order is paid, a plan starts, a menu is published, a cron job runs). A database trigger or job calls `queue_email(template, to, payload, dedupe_key, …)`, which adds a row to `notifications_log`. A repeated dedupe key is ignored, so a replayed Stripe webhook or a re-run job never queues a second copy. Nothing in checkout waits on email.
2. **The worker** (`/api/cron/notifications`, Vercel Cron every minute → `lib/email/worker.ts`) claims due rows one at a time (conditional update, so overlapping runs can't double-send), builds the display values (`lib/email/vars.ts`), renders and sends (`lib/email/send.ts`).
3. **Rendering** (`lib/email/templates.tsx`, `emails/layout.tsx`): the template's subject, preview text, body and button label come from `email_templates`; logo and colours from Settings. Only the `{{variables}}` that template is allowed to use (`lib/email/catalog.ts`) are filled in. Values go into React text nodes, so they're escaped and can never become HTML or script; subjects are forced onto one line (no header injection); a button only renders for an `http(s)` link. Every email has an HTML and a plain-text part, a dark-mode palette, and a fluid 560 px layout for phones.
4. **Delivery**: Resend with the row id as the idempotency key (a crash between "sent" and "marked sent" can't send twice), or Mailpit locally. Failures retry after 1, 5, 30 and 120 minutes, then stop as `failed`. 4xx errors from Resend (bad address) don't retry.
5. **Privacy in the log**: once handled, `to_address` is cleared; only `recipient_hash` (SHA-256 of the lowercased address), template key, status, attempts and error stay. Bodies are never stored. One-time link tokens are scrubbed from the payload.

### The emails

| Audience | Emails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Families | Welcome/confirm, magic link, password reset, email change (Supabase Auth, branded); security notices for password changed, email changed, sign-in method linked/removed, two-step sign-in added/removed; order confirmed (meals per child and day, total, **allergy recap**), updated, cancelled, refunded; **order reminder** before cutoff with "Repeat last week"; new weekly menu; plan started (with the renewal terms the parent agreed to), renews soon, payment failed (update-card link), paused, resumed, cancelled, meals auto-picked / couldn't be picked; delivered; allergy conflict on an upcoming order; payment reminder |
| Schools  | Approved, next week's orders ready, invoice issued / due soon / overdue / paid, added as staff (existing account) or invited (new account, Supabase invite)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Owner    | New school application, **cutoff digest** (orders, meals, unpaid, needs attention), daily **payments summary** (only when something's wrong), **security**: staff role granted, owner sign-in from a new device                                                                                                                                                                                                                                                                                                                                                                                                                           |

Triggers live in `supabase/migrations/20261128000100_email.sql` (orders, subscriptions, menu published, invoice paid, staff role granted). Jobs (pg_cron): order reminders every 15 minutes, renewal notices, cutoff digest (when the week closes), payments summary (daily), invoice due soon.

### Order reminders and "Repeat last week"

- Sent **N hours before cutoff** (Settings → Email, default 24) to onboarded households that haven't ordered, plus subscribers who still have plan meals to pick. Households whose plan skipped the week are left out.
- The button is a **single-use link** (`/r/<token>`), hashed at rest, valid until that week's cutoff. Tapping it lands on a one-button page (email security scanners open links automatically; spending the token on a plain page load would break it for the parent). Pressing the button signs the parent in and opens the order page with last week's meals loaded; every allergy and menu check runs again there.
- Staff accounts are never signed in by a link (they need MFA). If someone else is signed in on the device, or the link expired, it goes to sign-in and then to the order page.

### Preferences and unsubscribe

- `/account/notifications`: the two optional topics (new weekly menu, order reminders). Account, order, plan and security emails can't be turned off.
- Optional emails carry the mailing address (Settings → Email) and an unsubscribe link, plus RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers so Gmail and Yahoo show their one-click button. The link page (`/unsubscribe`) changes nothing until its button is pressed; the one-click POST (`/api/unsubscribe`) works without signing in. The token identifies only a preferences row and both endpoints are rate-limited.

### California Automatic Renewal Law (asked for in this phase)

- Each plan's **Start this plan** button now has an "Automatic renewal" box beside it: renews automatically until cancelled, the amount for this household and how often, any trial or minimum term, and how to cancel (online on the Plan page, or by email).
- A **required checkbox**. The server refuses to start a plan without it, rebuilds the terms itself (never trusting the browser) and stores them with the time (`subscriptions.renewal_terms`, `renewal_consent_at`).
- The **plan started** email repeats those exact terms. All wording is owner-editable (`sub.arl_*` in Content).

### Owner tools

- **Content → Emails → (any email)**: when it's sent, who gets it, whether people can turn it off; subject, preview text, button text, message; variable buttons limited to what that email can use; **Preview** in light and dark mode; **Send a test to me** (unsaved draft, sample details); **Recently sent** with status, attempts, errors and the hashed recipient.
- **Settings → Email**: reminder hours before cutoff, renewal notice days, mailing address for footers, reply-to address.
- **Content**: new groups for shared email wording (footers, reminder reasons), the preferences page and the unsubscribe page.

## How to test

```bash
pnpm db:test                 # 353 pgTAP tests, incl. phase9 (40): queue + dedupe, recipient hash, triggers, cutoff targeting, tokens, preferences, RLS
pnpm test                    # unit: rendering, escaping/injection, allow-list, CTA safety, footers, device labels
pnpm exec playwright test e2e/email.spec.ts   # queue → worker → Mailpit: idempotent confirmation, List-Unsubscribe, opt-out, unsubscribe page + one-click, ARL consent
```

By hand: run the app, open Mailpit at <http://127.0.0.1:54324>, then trigger the worker:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/notifications
```

## Going live with Resend (deliverability checklist)

Do this on staging first, with a Resend test domain, then production.

1. **Use a mail subdomain**, e.g. `mail.smartcookie.com`, so email reputation is separate from the main site. Add it as a domain in Resend.
2. **SPF and DKIM**: add the DNS records Resend shows for the subdomain (an MX + TXT for the bounce/SPF path and the DKIM TXT/CNAME records). Wait until Resend shows the domain as **Verified**.
3. **DMARC**: add `_dmarc.smartcookie.com` TXT `v=DMARC1; p=none; rua=mailto:dmarc@smartcookie.com` (or the subdomain). Watch the reports for 2–4 weeks; when only Resend and your own mail show up as passing, move to `p=quarantine`, later `p=reject`.
4. **Environment variables** (Vercel, per environment): `RESEND_API_KEY` (a sending-only key), `EMAIL_FROM=hello@mail.smartcookie.com`. Leave `MAILPIT_URL` unset (the app refuses to boot with it in production).
5. **Settings → Email**: set the reply-to to Hannah's inbox and the mailing address (required in optional emails).
6. **Supabase Auth emails through Resend**: Supabase dashboard → Authentication → SMTP: host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender `hello@mail.smartcookie.com`, name "Smart Cookie". Copy the HTML from `supabase/templates/*.html` into Authentication → Email Templates (the security notification templates too), and turn on the security notifications listed in `supabase/config.toml`.
7. **Cron**: set `CRON_SECRET` in Vercel; the `vercel.json` cron calls the worker every minute (Vercel Pro is needed for per-minute crons; on Hobby, change it to daily or call it from pg_cron with `pg_net`).
8. **Check**: send each email from Content → Emails → Send a test to me; check Gmail and Outlook (desktop + phone, light + dark), and run one through <https://www.mail-tester.com>.

## Known gaps

- **Not sent through Resend yet** (no key or domain); verified end-to-end with Mailpit only.
- **Price-change notice** for subscribers (California ARL) isn't built; Phase 6 keeps existing subscribers on their price, so it's only needed before the first price change.
- **Delivery and bounce tracking**: statuses stop at `sent`. Resend webhooks (delivered, bounced, complained) could update `notifications_log` and auto-suppress bad addresses; not built.
- Email copy in the database isn't versioned (the audit log records each save with the editor).
- "Repeat last week" needs one extra tap on the landing page (deliberate, for link scanners).
- The owner new-device alert uses a coarse browser + OS label, so a second Chrome-on-Mac counts as the same device.
