# Phase 3: Data model, RLS and seed data

## What was built

Five migrations (`supabase/migrations/20261122*`) add **40 tables, 5 views and the core business functions**. Every table has RLS enabled in the migration that creates it (46/46 public tables, checked). The diagram is in [`docs/erd.md`](./erd.md), regenerated from the live schema with `pnpm db:erd`.

| Area               | Tables                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delivery & schools | `delivery_zones`, `organizations` (extended), `classrooms`, `standing_orders`, `invoices`, view `organization_members`                                                                                                                                 |
| Households         | `households`, `household_members`, `addresses`, `children`, `allergens`, `child_allergens`                                                                                                                                                             |
| Menu               | `menu_categories`, `dietary_badges`, `menu_items`, `menu_item_images`, `menu_item_badges`, `menu_item_allergens` (`contains` / `may_contain`), `menu_weeks`, `menu_week_items`, `menu_templates`, `menu_template_items` + Storage bucket `menu-images` |
| Plans              | `plans`, `plan_price_history`, `subscriptions`, `subscription_allowances`                                                                                                                                                                              |
| Orders             | `orders` (human-friendly `SC-2026-001001` numbers), `order_items` (name/price/allergen/badge snapshots), `favorites`, `saved_orders`, `allergy_overrides`                                                                                              |
| CMS & settings     | `site_settings` (singleton), `content_blocks` + `content_versions`, `pages`, `faqs`, `testimonials`, `email_templates`, `media`, `discount_codes`                                                                                                      |
| Ops                | `stripe_events`, `notifications_log`, `pilot_invites`                                                                                                                                                                                                  |

### Business functions

| Function                                                                   | What it does                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_family_order(household, week, items, fulfillment, address, notes)` | The **only** way an app user creates an order. Recomputes every price from the menu, **blocks allergy conflicts**, and checks the ordering window and cutoff, capacity, the child's household, the delivery zone (ZIP), delivery weekdays and the minimum order. Computes the delivery fee and free-over threshold, and snapshots address, names, allergens and badges. |
| `meal_allergy_conflicts(child, item)`                                      | Lists conflicts and whether each one blocks (`contains` always blocks; `may_contain` blocks for _severe_ allergies). An owner override clears the block.                                                                                                                                                                                                                |
| `confirm_order_allergies(order)`                                           | Records the checkout allergy confirmation (CLAUDE.md §6).                                                                                                                                                                                                                                                                                                               |
| `menu_week_cutoff(week)`                                                   | Effective cutoff: the week's own value, else the default rule (Thursday 6pm before the week) in `America/Los_Angeles`.                                                                                                                                                                                                                                                  |
| `generate_rotation_weeks(weeks_ahead)`                                     | Creates draft weeks ahead from the Week A/B/… template cycle. Runs weekly via **pg_cron**, and the owner can trigger it.                                                                                                                                                                                                                                                |
| `guard_price_columns(...)` (trigger)                                       | Any change to a price-bearing column needs **owner + AAL2 + an MFA check within 5 minutes**; the service role is exempt. Applied to menu prices, week and template price overrides, zone fees, plans, discount codes and tax settings.                                                                                                                                  |
| `record_plan_price` (trigger)                                              | Appends to `plan_price_history` on every plan price change (Stripe Prices are immutable).                                                                                                                                                                                                                                                                               |

### Access model (what the tests prove)

| Who                      | Can                                                                                                                                                                                                                                      | Can't                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anon**                 | Published weeks and their items, active menu items and their images, badges and allergens, active plans and zones, published FAQs and testimonials, and the public views `site_settings_public`, `content_blocks_public`, `pages_public` | Children, orders, addresses, raw settings, drafts, templates, the kitchen view                                                                     |
| **Parent**               | Their household, members, addresses, children, child allergens, favorites, saved orders; read their own orders and subscriptions; place orders through `create_family_order`                                                             | Insert orders directly, change totals, see other households, write the menu, read raw settings                                                     |
| **School admin / staff** | Their organization, classrooms and standing orders; children enrolled through their school and those children's allergens; admins manage classrooms and (if approved) standing orders, and read invoices                                 | Other schools' data, children not enrolled with them, changing their own approval status; staff can't add classrooms                               |
| **Kitchen (AAL2)**       | `kitchen_order_lines`: item, quantity, allergen snapshot, child first name and last initial, child allergies (with "(severe)"), dietary preferences, classroom, school and household name for paid, invoiced or fulfilled orders         | Anything at AAL1; direct access to orders, children or addresses; prices, payments, emails, phones (the view has no such columns, which is tested) |
| **Ops (AAL2)**           | Read and update orders (status, notes, delivery date), customers, households, addresses, schools, classrooms, standing orders, zones (non-fee fields)                                                                                    | Prices, plans, site settings, menu, roles                                                                                                          |
| **Owner (AAL2)**         | Everything above, plus menu, plans, CMS, settings and discount codes. Prices, plans, tax settings and allergy overrides also need a fresh MFA step-up                                                                                    | Delete Stripe events; update or delete the audit log                                                                                               |

## How to test

```bash
pnpm db:start        # or: pnpm db:reset to rebuild from migrations + seed
pnpm db:test         # 88 pgTAP assertions (32 Phase 2 + 56 Phase 3)
pnpm db:erd          # regenerate docs/erd.md
```

Seeded accounts for local use only, all with password `SmartCookie-local-2026!`:

| Email                                                                          | Role                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `owner@smartcookie.test` / `ops@smartcookie.test` / `kitchen@smartcookie.test` | Staff, with TOTP pre-enrolled using the local-only secret `JBSWY3DPEHPK3PXP` |
| `parent@smartcookie.test`                                                      | Household with Maya (severe sesame, enrolled at Maple Grove) and Leo (milk)  |
| `parent2@smartcookie.test`                                                     | Household with Ava (wheat intolerance, enrolled at Maple Grove)              |
| `school@smartcookie.test` / `teacher@smartcookie.test`                         | Maple Grove Elementary admin / staff (approved school, 3 classrooms)         |

The seed also includes the top-9 allergens, 6 badges, 4 categories, 20 kid-friendly meals with allergens, 2 rotation templates, 3 published weeks starting next Monday (the current week stays a draft), 3 plans, 2 LA-area zones, a standing order, a paid sample order, CMS starter copy, pages, FAQs, testimonials, email templates and pilot invites.

Verified end to end through the real API: anon reads the published menu but not orders. The parent's order for Maya with teriyaki (sesame, severe) is refused with `ALLERGY_BLOCK`, while a valid order totals $25.75 + $4.99 delivery from server prices. A parent can't edit totals. The kitchen account sees nothing at AAL1 and sees names, allergies and classrooms (no addresses) after TOTP with the seeded secret.

Results: `pnpm db:test` 88/88, `pnpm typecheck`, `pnpm lint` and `pnpm test` (45) pass; `pnpm test:e2e` 39/39 against the seeded database.

## Deviations from the brief

1. **`organization_members` is a view, not a table.** Phase 2 already stores school membership in `user_roles` (`school_admin` / `school_staff` with `organization_id`), which also feeds the JWT `org_ids` claim. A second table would mean two sources of truth for "who belongs to which school".
2. **Organization status keeps `approved`** (Phase 2 values: `pending | approved | rejected | suspended`) instead of `active`. Same meaning, no migration churn.
3. **Public views for mixed tables.** `content_blocks`, `pages` and `site_settings` hold drafts or internal fields next to public ones, and RLS can't hide columns per user. Anon reads `content_blocks_public`, `pages_public` and `site_settings_public` instead, so drafts never leave the database. FAQs, testimonials, plans, zones and the menu are readable directly with row-level conditions.
4. **Kitchen data only through `kitchen_order_lines`**, a view that re-checks the role at AAL2 on every query. Kitchen staff have no direct access to orders, children or addresses.
5. **Rotation settings live in `site_settings`** (`rotation_anchor_week`, `rotation_weeks_ahead`); templates carry `rotation_position` (Week A = 1, B = 2…).
6. **Rich text** is stored as JSON (`{"blocks":[{"type":"paragraph","text":"…"}]}`) so the admin editor (Phase 4+) can render and validate it. No raw HTML is stored.
7. **Placeholder images** use `storage_path = 'placeholder:<art-key>'` to point at the built-in cartoon art until real photos are uploaded to the `menu-images` bucket.
8. **Households are created at sign-up** for parents (the `handle_new_user` trigger now also creates the household and owner membership). Existing parents were backfilled.
9. Orders also store `placed_by`; allergy overrides store `revoked_at` (soft revoke, keeps history).

## Decisions I need you to confirm

1. **May-contain policy:** `may_contain` currently blocks only when the child's allergy is marked **severe**, and only warns otherwise. Should it always block, or never block?
2. **Default cutoff:** Thursday 6pm (Los Angeles) before the delivery week, and ordering opens 14 days before. Are both right?
3. **Delivery weekdays:** seeded as Mon–Fri for Pasadena and Mon/Wed/Fri for Silver Lake. Are these the real zones, ZIPs, fees, free-delivery thresholds and minimums?
4. **Who may edit zones:** ops can edit zone names, ZIPs and days, but not fees, which need owner + step-up. OK?
5. **Creating a new priced menu item or plan** counts as "changing prices", so it needs a fresh MFA step-up. Acceptable, or step-up only on edits?
6. **School prices:** `school_price_cents` is optional per item. Should schools fall back to the family price, or must every item have a school price before it can go on a school order?
7. **Kitchen visibility of the household name** (e.g. "The Patel household"), which can include a surname. The brief allows it; alternatively labels could show only child first name, last initial and classroom.
8. **Ops refund limit:** "refunds up to a limit" needs a number (e.g. $100 per order) for the payments phase.
9. **Capacity:** counted across pending, paid, invoiced and fulfilled orders, so an unpaid cart holds stock. Should pending orders expire (e.g. after 30 minutes) to free capacity?
10. **Second parent in a household:** the table supports it; the invite flow (email invite and accept) is planned for the account phase. OK to defer?

## Known gaps

- **No UI changes this phase.** The `/menu` page still shows the demo week; wiring pages to these tables is the menu/ordering phase.
- **Subscriptions, allowances and invoices** have tables and read policies, but they're written by the Stripe webhook (payments phase). Discount-code redemption is not implemented yet.
- **`create_family_order` doesn't yet handle** subscription allowances, discount codes or tax (tax is 0 until Stripe Tax is decided). School bulk orders from standing orders aren't generated yet.
- **The rotation job** schedules a weekly pg_cron run. On hosted projects, enable the `pg_cron` extension first (Database → Extensions) before pushing migrations.
- **Account deletion** (Phase 2) should now also remove children (cascade via household), null `orders.household_id` (keeps the accounting snapshot) and cancel Stripe subscriptions. The data model supports this; the deletion action needs updating in the account phase.
- **ERD rendering wasn't verified.** `docs/erd.md` is generated from the schema; rendering it with Mermaid CLI was blocked in this environment, so check that it displays on GitHub.
