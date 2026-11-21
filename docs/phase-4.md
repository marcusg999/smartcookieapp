# Phase 4: Admin portal and CMS

## What was built

The owner can now change everything a customer sees from `/admin`, without a developer. Every admin page re-checks the role on the server and needs AAL2 (TOTP). Every admin Server Action goes through one wrapper, `lib/admin/action.ts`, which runs these steps in order:

1. Authorize: role at AAL2, plus step-up where the action needs it.
2. Rate limit.
3. Validate the input with Zod.
4. Write with the user's own client, so RLS stays the final gate.
5. Turn database errors into friendly messages.
6. Write an audit entry.
7. Expire cache tags with `updateTag` (read-your-own-writes).

### Navigation (role-filtered, enforced on the server)

| Area                                                                 | Owner | Ops                                 | Kitchen |
| -------------------------------------------------------------------- | ----- | ----------------------------------- | ------- |
| Dashboard                                                            | ✓     | ✓                                   | ✓       |
| Orders, Customers, Schools                                           | ✓     | ✓                                   | 403     |
| Delivery zones                                                       | ✓     | ✓ (owner + step-up for fee changes) | 403     |
| Menu (Items, Weekly menus, Templates, Categories, Badges, Allergens) | ✓     | 403                                 | 403     |
| Plans, Content, Discounts, Staff, Settings, Audit log                | ✓     | 403                                 | 403     |

Non-staff get a **404** for anything under `/admin`, so the area doesn't reveal itself. Staff who open a page their role can't use get a **403** (`forbidden()`, with `experimental.authInterrupts` enabled in `next.config.ts`).

### Screens

**Menu items**

- Editor fields: name, description (Tiptap rich text, sanitized against an allow-list on the server, rendered as React elements and never as raw HTML), category, portion, badges, allergens (contains / may contain), ingredients and nutrition.
- Photos are drag-and-drop, reorderable and have alt text.
- Actions: duplicate, archive and restore. Delete is blocked when an order references the item.
- Saving with no allergens asks for an explicit confirmation.

**Prices and Stripe**

- A price change needs **step-up**.
- It creates a new Stripe Price and archives the old one, and `menu_item_price_history` keeps every price.
- The database trigger `guard_price_columns` enforces this independently of the app.

**Image pipeline** (`lib/images/process.ts`)

- Magic-byte sniffing allows JPEG, PNG, WebP and AVIF only.
- Size cap of 8 MB.
- `sharp` rotates the image, strips EXIF and location data, resizes to at most 2000px and converts to WebP.
- Stored under a random path.

**Weekly menus**

- Add or remove items, set per-week price overrides (step-up) and capacity.
- Delivery dates, and a cutoff entered in the business timezone.
- Apply a template, copy last week, save as a template.
- A rotation (Week A/B/…) generates draft weeks ahead.
- Publishing is validated: items present, cutoff in the future, at least one delivery date.
- Preview with `/menu?preview=<id>`, for the owner only.

**Plans**

- Builder with a live preview.
- Saving syncs to Stripe (new Price on a change).
- When a price changes, the owner chooses whether existing subscribers move to the new price or keep the old one.

**Delivery zones**

- ZIPs, fee, free-over threshold, minimum order, weekdays and window.
- A ZIP tester shows which zone covers an address.

**Content**

- **Site text:** every key in `lib/content/registry.ts`, grouped like the site, with draft → preview → publish. Every version is kept and can be restored.
- **Pages:** legal and info pages with reserved-slug protection.
- **FAQs** and **Testimonials**.
- **Emails:** templates with `{{variables}}`, a sandboxed preview and a test send (Resend; mocked locally).
- **Media library:** alt text, and a safe delete that is blocked while anything uses the file.

**Customers**

- Search households.
- View children with allergies in red, adults, addresses, subscription, orders and lifetime value.
- Private staff notes.
- Account credits (step-up; append-only).

**Schools**

- Approve, decline or suspend.
- Billing email, payment terms, tax-exempt status and drop-off instructions.
- Classrooms with headcount.
- Standing orders and invoices (read-only until Phase 6).

**Discounts**

- Percent or fixed codes with max uses and an expiry.
- Changing an amount needs step-up. Codes can be switched on and off.

**Settings**

- Business info and contact details.
- Logo upload, which replaces the cookie mascot everywhere.
- **Brand colours**, applied through CSS variables in a nonce'd `<style>`, with a live preview and a WCAG contrast check that blocks unreadable combinations.
- Timezone and the default cutoff rule.
- Announcement banner.
- **Ordering on/off** with a custom paused message.
- Pilot mode.
- Tax settings (step-up).

**Audit log**

- Owner-only and read-only.
- Filter by action or entity, with expandable before → after diffs.

**Dashboard**

- Next week's orders and money (ops/owner), active subscribers, schools awaiting approval.
- A to-do list of unpublished upcoming weeks.

**UX throughout**

- Unsaved-changes guard and bar, toasts, and confirm dialogs on destructive actions.
- Works at 375px and on iPad (checked; no horizontal scroll on any admin page).

### Public site now reads from the CMS

- **Home page, nav, footer, menu page, family tab bar and account page:** every word comes from `content_blocks`. The registry holds 66 keys, all seeded.
- **`/menu`:** the real published weeks from the database. Meal cards show photos, price, badges and allergens (red) with CMS labels, the cutoff in the business timezone, and the paused-ordering message.
- **Caching:** content, settings, menu and pages are cached with tags (`unstable_cache`) and expired by `updateTag` from admin actions.
- **Owner preview:** draft mode (`/api/preview`) shows draft copy to an owner at AAL2 only. It never reads or writes the shared cache.
- **Brand assets:** brand colours, logo and announcement come from `site_settings`. The PWA icons and manifest are recoloured to the logo palette.
- **No-hard-coded-copy check:** `lib/content/no-hardcoded-copy.test.ts` parses every `.tsx` file under `app/(marketing)` and `app/(family)` with the TypeScript compiler and fails on any literal sentence in JSX text or in copy props (`title`, `description`, `placeholder`, `alt`…).

### Database (`supabase/migrations/20261123000100_admin_portal.sql`)

- **Prices:**
  - `menu_items.stripe_price_id` and `stripe_school_price_id`, guarded like prices.
  - `menu_item_price_history`, kept by a trigger. A new amount opens a row; the Stripe id that follows fills it in.
- **Allergens:** the top-9 allergens can't be renamed, archived or deleted (trigger).
- **New tables:**
  - `customer_notes` and `account_credits`, append-only, for ops and owner at AAL2.
  - Credits can be read by the household they belong to, and every credit is audited.
- **Atomic saves:**
  - `set_menu_item_tags`, `set_menu_week_items`, `set_menu_template_items`: replace a meal's allergens and badges, or a week's or template's meals, in one transaction, so a failed save never leaves a meal without allergens or a week half-emptied.
  - `guard_price_columns` now treats an INSERT as a price change only when it actually sets a price.
- **Media:**
  - `media_usage_count(path)` for safe deletes. Staff only; anon can't execute it.
  - The `media` storage bucket accepts writes from the owner only.
- **Settings:** `site_settings.ordering_paused_message`, and brand colours defaulted to the logo palette.

## How to test

```bash
pnpm exec supabase start -x studio,edge-runtime,logflare,vector,imgproxy,realtime,supavisor,postgres-meta
```

```bash
pnpm exec supabase db reset
```

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm db:test
```

```bash
pnpm build && pnpm exec playwright test --trace off
```

- **Unit tests (Vitest):** 67 tests. These include the registry (unique keys, valid defaults, every key seeded) and the no-hard-coded-copy scan.
- **RLS tests (pgTAP):** 134 tests, 46 of them new in `supabase/tests/phase4.test.sql`. For each new table, the right role can, other roles can't, and anon can't.
- **E2E tests (Playwright):** `e2e/admin.spec.ts` covers:
  - The owner edits the hero, previews the draft, publishes, and a visitor sees it.
  - A price change prompts step-up and stores a new (mocked) Stripe price id and a history row.
  - Kitchen staff don't see Plans or Settings and get a 403.
  - A renamed `.exe` is rejected by the image upload.
- **Manual check:** sign in as `owner@smartcookie.test` (password `SmartCookie-local-2026!`, TOTP secret `JBSWY3DPEHPK3PXP`).

After adding a key to `lib/content/registry.ts`, run `pnpm content:seed` to regenerate the `content_blocks` seed block.

## Known gaps

- **Account screens:** the security and privacy pages (`app/(family)/account/security`, `account/privacy`) still have system copy in code and are allow-listed in the copy test. They will be rebuilt with the family experience in Phase 5. The email footer line is also in code.
- **Orders:** the Orders screen is a list with week and status filters. Refunds, order edits and the kitchen views (cook list, labels, packing) come with checkout and fulfilment.
- **Stripe:** runs in mock mode locally (`sk_test_dummy`). Price saves create the new Stripe Price first, write the amount and price id in one update, then archive the old Price. If Stripe fails, nothing is saved, or a new item is saved without a price id and syncs on its next save.
- **Logo:** the logo was shared in chat but not as a file. Upload it in **Settings → Logo & colours** to replace the mascot, or attach the file so it can ship as the default.
- **Next.js:** `forbidden()` relies on Next's experimental `authInterrupts` flag.
- **Content keys:** the content type `image` is supported by the editor, but no registry key uses it yet.

---

## Owner guide (for Hannah)

Everything customers see can be changed by you in the admin. Sign in at **/sign-in**, then enter the 6-digit code from your authenticator app. For important changes, such as prices, refunds, tax and staff, you'll be asked for a fresh code. That's normal: it protects your business if someone ever gets hold of your password.

### Change words on the website

1. Go to **Content → Site text** and pick a section (Home page, Menu page, Footer…).
2. Edit the text and press **Save draft**. Customers don't see it yet.
3. Press **Preview drafts** to see your changes on the real site (only you can see them).
4. Press **Publish** (or **Publish everything**). The site updates within seconds.
5. Made a mistake? Open **History** on any box and press **Restore** on an older version.

### Add or edit a meal

1. Go to **Menu → Items** and press **New meal**, or tap an existing one.
2. Fill in the name, short description, price and **allergens**. Tick every allergen it contains, and use "may contain" for shared-equipment warnings.
3. Add photos. Write a short description of each photo first (it helps families who use screen readers).
4. Press **Save changes**. Changing a price asks for your code.

### Build next week's menu

1. Go to **Menu → Weekly menus**, then **New week** (or **Copy last week**, or apply a template).
2. Add meals, set delivery days and, if needed, a different order-by time.
3. Press **Preview** to see it as families will.
4. Press **Publish**. Families can order until the cutoff.
5. Using a rotation? **Templates** lets you set up Week A / Week B, and the system creates draft weeks for you to check and publish.

### Pause ordering (holidays, sick days)

**Settings → Ordering**: switch to **Ordering is PAUSED**, write the message families will see, and **Save**.

### Show a banner

**Settings → Announcement banner**: turn it on, write the text (for example "No deliveries Nov 27, happy Thanksgiving!") and save.

### Change your logo or colours

**Settings → Logo & colours**: upload your logo and pick colours. The preview shows how it will look. If text would be hard to read, you'll see a warning and can't save until it's fixed.

### Help a family

**Customers**: search by household name. You'll see their children (allergies in red), orders and subscription. Add a private note (only staff see it) or an account credit (asks for your code).

### Approve a school

**Schools → Pending**: open the school, check the details and press **Approve**. Set their payment terms (for example 30 days) and billing email, and add their classrooms with student counts.

### Promo codes

**Discounts → New code**: choose percent or dollar amount, an optional limit and expiry, and save.

### Who changed what?

**Audit log** lists every change made in the admin: who made it, when, and what changed. Nobody can edit or delete it, including you.
