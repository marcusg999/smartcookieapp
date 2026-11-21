# Phase 2: Authentication, MFA, roles and the admin gate

## What was built

### Database (`supabase/migrations/`)

| Object                                                                                                          | Purpose                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profiles`                                                                                                      | One row per auth user (`full_name`, `phone`, `deleted_at`). Users can update only `full_name` and `phone` (column grants).                                                                                                                 |
| `organizations`                                                                                                 | Schools. Created `pending`; ops/owner approve.                                                                                                                                                                                             |
| `user_roles`                                                                                                    | Source of truth for roles (`parent`, `school_admin`, `school_staff`, `kitchen`, `ops`, `owner`), optional `organization_id`, `granted_by`, `granted_at`. Unique on (user, role, org). School roles must have an org; other roles must not. |
| `audit_log`                                                                                                     | Append-only. Insert only via `log_audit_event()` (actor = `auth.uid()`, can't be spoofed). Select: owner at AAL2. Update, delete and truncate are blocked by triggers **for every role, including service_role and postgres**.             |
| `auth_attempts`                                                                                                 | Hashed failed-attempt log for lockout. No policies: server (service role) only.                                                                                                                                                            |
| `handle_new_user` trigger                                                                                       | Creates the profile and assigns `parent`, or `school_admin` of a new **pending** organization when the sign-up chose "school". User metadata can never grant a staff role.                                                                 |
| Helpers (`security definer`, `search_path = ''`)                                                                | `has_role`, `is_staff`, `is_owner`, `is_aal2`, `org_role`, `has_recent_mfa`, `is_staff_aal2`, `is_owner_aal2`, `has_any_role_aal2`.                                                                                                        |
| `custom_access_token_hook`                                                                                      | Adds `app_roles` and `org_ids` to the JWT from `user_roles` only. It overwrites any spoofed values and strips role-like keys from `user_metadata`.                                                                                         |
| `grant_role` / `revoke_role`                                                                                    | The **only** write path to `user_roles` for app users. Staff roles need owner + AAL2 + an MFA verification within 5 minutes. A school admin of an approved school can manage its `school_staff`.                                           |
| `protect_last_owner` trigger                                                                                    | Prevents removing or deleting the last owner, including by cascade from deleting their auth user.                                                                                                                                          |
| Row-change audit triggers                                                                                       | Every insert, update and delete on `user_roles` and `organizations` is audited, whoever makes it.                                                                                                                                          |
| `my_sessions`, `admin_list_staff`, `admin_revoke_sessions`, `admin_find_user_id`, `request_school_organization` | Session list, owner staff view, force sign-out, invite lookup, school request after OAuth sign-up.                                                                                                                                         |

Function execute rights are revoked from `anon` and `public` by default. Only the functions the app calls are granted to `authenticated`.

### Auth config (`supabase/config.toml`, local; mirror it on each hosted project)

12-character minimum password; email confirmation required; magic links and OTPs expire after **10 minutes** and work once; 60 s between emails; secure password change; access tokens last **15 minutes** with refresh-token rotation and reuse detection; passkeys (WebAuthn RP = `localhost` locally); TOTP MFA; manual identity linking; the custom access token hook; email templates that send links to `/auth/confirm` with a `token_hash`.

### App

| Area                                                                                                                                                                                    | Files                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Guards: `getUser`, `requireUser`, `requireRole`, `requireStaffAAL2`, `requireAAL2`, `requireRecentReauth`, `authorizeAction`, `postSignInDestination`                                   | `lib/auth/guards.ts`                                              |
| Proxy: coarse redirects (family/school → sign-in), `/admin` 404 for non-staff, AAL1 staff → MFA enroll/challenge, admin **30-min idle** and **12-h absolute** limits                    | `proxy.ts`, `lib/auth/routes.ts`                                  |
| Unified `/sign-in`: Google, Apple, passkey, email (magic link or password)                                                                                                              | `app/(auth)/sign-in`, `components/auth/*`                         |
| `/sign-up`: "I'm a parent" / "I'm ordering for a school", Google/Apple or email + password with a strength meter                                                                        | `app/(auth)/sign-up`, `components/auth/sign-up-form.tsx`          |
| Server Actions: Turnstile + per-IP limiter + Zod + generic messages + lockout + audit                                                                                                   | `app/(auth)/actions.ts`                                           |
| Email-link landing (confirm, magic link, recovery, invite, email change) and OAuth callback (PKCE)                                                                                      | `app/auth/confirm`, `app/auth/callback`, `app/auth/after-sign-in` |
| Forgot / reset password                                                                                                                                                                 | `app/(auth)/forgot-password`, `app/(auth)/reset-password`         |
| Admin gate: `/admin/(console)` requires staff + AAL2; `/admin/mfa/enroll` (QR + backup codes) and `/admin/mfa/challenge` work at AAL1                                                   | `app/admin/**`, `components/mfa/*`                                |
| Step-up modal: `useStepUp()` asks for a fresh TOTP code when an action returns `step_up_required`, then retries                                                                         | `components/mfa/step-up.tsx`                                      |
| Staff management (owner only, step-up on every change): invite by email, grant/revoke roles, last sign-in, MFA status, force sign-out                                                   | `app/admin/(console)/staff/*`                                     |
| Account security: link/unlink Google and Apple (one method always remains), passkeys, change password (signs out other sessions), optional TOTP, active sessions, "Sign out everywhere" | `app/(family)/account/security`, `components/account/*`           |
| Privacy: JSON data export, account deletion (type DELETE + signed in within 10 min)                                                                                                     | `app/(family)/account/privacy/*`                                  |
| Owner bootstrap CLI                                                                                                                                                                     | `scripts/owner-bootstrap.mts` (`pnpm owner:bootstrap <email>`)    |

### Decisions

- **Passkeys use Supabase's native WebAuthn API, not SimpleWebAuthn.** The installed `@supabase/supabase-js` (2.119) exposes `signInWithPasskey()`, `registerPasskey()` and `auth.passkey.list/delete`, and the bundled auth server supports `[auth.passkey]`. Supabase stores and verifies the credentials and issues the session itself. That means no `webauthn_credentials` table and no custom challenge handling, so there's less security-sensitive code of ours to get wrong. The SDK marks the API as recently stabilised; the docs page still calls it experimental.
- **TOTP is verified server-side** (Server Action), so failed codes count toward the lockout and are audited.
- **Lockout:** 5 failed passwords (per account) or 5 failed MFA codes (per user) within 15 minutes locks that method for 15 minutes. Magic links still work during a password lockout. Keys are SHA-256 hashes.
- **Turnstile:** verified server-side in every auth Server Action. With Cloudflare's documented test keys (local and CI) no widget loads and a fixed dummy token is accepted. The env schema **rejects test keys in production**.
- **Rate limits:** the Phase 1 Upstash limiters. With the placeholder Upstash URL in development or CI, an in-memory limiter is used; production refuses the placeholder.
- **Leaked passwords:** checked server-side against Have I Been Pwned with k-anonymity (only 5 hash characters leave the server). It fails open if HIBP is unreachable. Also enable Supabase's own leaked-password protection on hosted projects.
- **Generic responses:** sign-in failures, magic links, resets and sign-ups all return the same message whether or not the account exists.
- **Post-sign-in routing** goes through `postSignInDestination()`, because a redirect rendered inside a Server Action doesn't pass through the proxy. Staff below AAL2 go straight to MFA.
- **Force sign-out** deletes the user's `auth.sessions` rows, so refresh tokens stop working. An already-issued access token stays valid until it expires (at most 15 minutes).
- **Step-up window:** 5 minutes, enforced in both the server guard and the database (`has_recent_mfa(300)`). `STEP_UP_MAX_AGE_SECONDS` can only shorten the server-side window; e2e tests use 5 s.

### Account linking

- **Automatic linking (Supabase default):** when an OAuth sign-in returns an email that matches an existing account, Supabase links the identity **only if the provider reports the email as verified**. Before linking, it removes any unconfirmed identities on the existing user, which blocks pre-account takeover. An unverified email never links; it creates a separate account that can't see the first one's data.
- **Manual linking** (`enable_manual_linking = true`) powers Connect/Disconnect on `/account/security`. Disconnecting is refused when it would leave no sign-in identity.
- **Apple "Hide My Email":** Apple may return a private relay address (`…@privaterelay.appleid.com`). That address is verified and stable per app, but it won't match an existing email account, so it becomes a **separate account** (no automatic link). Users who want one account should sign in with their existing method and use **Connect Apple** on `/account/security`. To email relay addresses, register the sending domain (Resend) in Apple's _Private Email Relay Service_ settings. Apple only sends the user's name on the **first** authorization; the callback stores it via the profile trigger when Supabase passes it through.

## How to test

```bash
pnpm db:start            # local Supabase (Docker); applies migrations
pnpm supabase status     # copy API URL + publishable/secret keys into .env.local
pnpm db:test             # 32 pgTAP RLS/identity tests
pnpm test                # 45 unit tests
pnpm build && pnpm test:e2e   # 39 Playwright tests (needs the local stack)
```

Manual checks: emails land in Mailpit at <http://127.0.0.1:54324>. To create the first owner, sign up, confirm the email, then run `pnpm owner:bootstrap you@example.com`, sign in and visit `/admin`. You'll be sent to MFA enrollment.

Results at the end of this phase (run locally in the build container):

- `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm format:check`: pass.
- `pnpm test`: **45 passed**.
- `pnpm db:test`: **32 passed**. A parent can't read others' roles or give themselves a role; kitchen at AAL1 is denied an admin table and allowed at AAL2; owners need AAL2 and a fresh step-up to grant staff roles; the last owner can't be removed; the audit log is append-only even for postgres; anon is denied; the JWT hook ignores spoofed `user_metadata`.
- `pnpm test:e2e`: **39 passed**. Covered: sign up with password → email verification via Mailpit → signed in → sign out → sign in; magic link; generic errors for unknown or unconfirmed accounts; sign-in redirects; 404 at `/admin` for anonymous and parent users; staff without MFA forced to enroll; staff with MFA challenged; the step-up modal on a staff invite.
- `pnpm owner:bootstrap`: grants owner to a verified account, then refuses to run a second time.

## Provider setup checklist (per environment: dev, staging, production)

Each environment is a separate Supabase project with its own URLs. Repeat every step for each one, using that environment's site URL (for example `https://staging.smartcookie…` and `https://smartcookie…`).

### Supabase dashboard (each project)

- [ ] **Authentication → URL Configuration:** Site URL = the environment's `NEXT_PUBLIC_SITE_URL`. Redirect URLs: `<site>/auth/callback`, `<site>/auth/confirm`. For the dev project, also `http://localhost:3000/**` and the Vercel preview pattern. Nothing else.
- [ ] **Providers → Email:** confirm email ON, secure password change ON, minimum length **12**, OTP expiry **600 s**.
- [ ] **Providers → Email → Leaked password protection:** ON (Pro plan feature; the app also checks HIBP itself).
- [ ] **Sessions:** JWT expiry **900 s**; refresh-token rotation ON, reuse interval 10 s. Optional: time-box and inactivity timeout (Pro). The app already enforces the admin idle/absolute limits.
- [ ] **Multi-Factor:** TOTP enroll + verify ON. **Recovery codes ON.** This setting can't be enabled through the local CLI yet; locally the enrollment page shows a fallback note instead of codes.
- [ ] **Passkeys:** enable. RP display name "Smart Cookie", RP ID = the bare production domain (e.g. `smartcookie.com`), origins = `https://<site>`. **Pick the RP ID before users enroll: changing it invalidates every passkey.**
- [ ] **Auth Hooks → Custom Access Token:** Postgres function `public.custom_access_token_hook`.
- [ ] **Email templates:** paste the templates from `supabase/templates/` (links go to `/auth/confirm?token_hash=…`). Set custom SMTP (Resend) so emails come from your domain and aren't rate-limited.
- [ ] **Manual linking:** ON (Authentication → Settings).
- [ ] Apply migrations: `pnpm supabase link --project-ref <ref>` then `pnpm supabase db push`.
- [ ] Bootstrap the first owner: `NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… pnpm owner:bootstrap hannah@…`.

### Google Cloud (OAuth)

- [ ] Create (or pick) a Google Cloud project per environment, or one project with separate OAuth clients.
- [ ] **OAuth consent screen:** app name "Smart Cookie", support email, logo, privacy policy and terms URLs, authorized domain = your domain. Scopes: `openid`, `email`, `profile` only.
- [ ] **Credentials → OAuth client ID (Web application):**
  - Authorized JavaScript origins: `https://<site>` (dev: `http://localhost:3000`).
  - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (local: `http://127.0.0.1:54321/auth/v1/callback`).
- [ ] Copy the Client ID and secret into **Supabase → Providers → Google**. Locally: `[auth.external.google]` in `config.toml` with `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`, never committed.
- [ ] Publish the consent screen (move out of "Testing") before launch.

### Apple Developer (Sign in with Apple)

- [ ] **App ID:** Certificates, Identifiers & Profiles → Identifiers → App IDs → register one (e.g. `com.smartcookie.app`) with **Sign in with Apple** enabled.
- [ ] **Services ID** (this is the OAuth `client_id`): Identifiers → Services IDs → register (e.g. `com.smartcookie.web`), enable Sign in with Apple, then **Configure**:
  - Primary App ID: the App ID above.
  - Domains and subdomains: your site domain **and** `<project-ref>.supabase.co`.
  - Return URLs: `https://<project-ref>.supabase.co/auth/v1/callback`.
- [ ] **Key:** Keys → create a key with Sign in with Apple, linked to the App ID. Download the `.p8` (only once) and note the **Key ID** and your **Team ID**.
- [ ] Generate the client secret JWT from Team ID + Key ID + `.p8` (Supabase's dashboard has a generator). **It expires after at most 6 months; diary a renewal.**
- [ ] Supabase → Providers → Apple: Services ID as client ID, the generated secret. Enable.
- [ ] **Private Email Relay:** Certificates, Identifiers & Profiles → Services → Sign in with Apple for Email Communication → register your sending domain and from-address (the Resend domain) so mail reaches `privaterelay.appleid.com` addresses.

### Cloudflare Turnstile

- [ ] Create a widget per environment (hostnames = that environment's domains). Put the site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the secret in `TURNSTILE_SECRET_KEY`. Production builds refuse Cloudflare's test keys.

## Known gaps

- **OAuth (Google, Apple) is wired but untested end to end.** It needs real credentials (checklist above). Locally the providers are disabled and the buttons show "isn't available right now".
- **Passkeys are wired to Supabase's native API but not covered by an automated test.** A Playwright virtual-authenticator test is a good follow-up. Registering needs a confirmed user, and RP ID/origins must match the domain.
- **Backup (recovery) codes** depend on a project setting that the local Supabase CLI (v3.2) can't enable. On hosted projects, turn on MFA recovery codes; until then the enrollment page suggests adding a second authenticator.
- **Account deletion** today removes the auth user, profile and roles, and anonymizes the profile first. Children, orders, Stripe subscriptions and payment methods don't exist yet. When those phases land, deletion must delete children, set orders' user reference to null (keeping the accounting snapshot), cancel subscriptions and detach payment methods. The export likewise gains those tables.
- **School approval UI** (owner/ops approving pending organizations) isn't built yet. The database policy and audit trigger are ready, and the school portal shows a "waiting for approval" banner.
- **Password reset for staff** goes through the same recovery link and still requires the MFA challenge afterwards (AAL2 for `/admin`).
- The custom email templates are plain local-dev HTML; production copy moves to the CMS / React Email in a later phase.
