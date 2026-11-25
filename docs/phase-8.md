# Phase 8: Chef dashboard and fulfillment

From the moment the cutoff passes, the kitchen knows what to cook, for whom, what to watch out for, how to label it and where it goes. The owner no longer stitches PDFs together.

Every screen is built for a kitchen: large type, high contrast, works on an iPad on the counter, and prints cleanly (navigation and buttons drop out, allergy red stays red).

## What was built

### This Week (`/admin`, the default view for owner, ops and kitchen)

- **Week bar:** week selector, and cutoff status ("Open until …" or "Closed").
- **Summary tiles:**
  - meals in total and by delivery day;
  - families vs schools;
  - paid / invoiced / unpaid (ops and owner only);
  - children with allergies;
  - capacity used per item, with a bar that turns red near the limit.
- **Needs attention:** a red banner at the top when any meal now clashes with a child's allergies.
- **Every order on one screen:** grouped by delivery day → destination (home zone → household, or school → classroom).
  - Columns: order #, customer, children, meals, allergy flags, notes, and payment (ops/owner only).
  - Search, a day filter, families/schools, and "allergy flags only".
  - Ops and owner can click through to the order.
- **Week actions:**
  - **Close week now** (owner, fresh authenticator code): runs the plan auto-fill first.
  - **Mark week fulfilled** (ops/owner, after cutoff).
- **Business section** (ops/owner): the Phase 6 revenue section and the owner's to-dos, moved below This Week.

### Cook list (`/admin/kitchen`)

- **Per delivery day:** each meal × total, split into **standard** vs **allergy-modified**, e.g. "Turkey wrap: 42 total, 38 standard, 4 Wheat-free".
- **What counts as allergy-modified:**
  - school allergy-safe alternates;
  - a child's allergen the meal may contain, or one covered by an owner exception;
  - any meal for a child with a **severe** allergy (cross-contact care).
- **What's left out:** meals that clash ("Needs attention") never appear. Unpaid à-la-carte orders are excluded by default after cutoff and listed separately (Settings → Kitchen).
- **Exports:** print, **PDF** and **CSV**. The CSV quotes cells and neutralises spreadsheet formulas.
- **Ingredient roll-up:** a hook is left (`ingredientRollup()`) for when items get structured ingredients.

### Allergy Board (`/admin/kitchen/allergies`)

- **Who's on it:** every child with an allergy who has a meal this week (first name + last initial, household or school/classroom), plus allergy-safe school meals for children the school counted but didn't link.
- **What each card shows:**
  - allergens with severity;
  - each meal and the allergens to prepare it safe for;
  - owner-approved exceptions, with the reason.
- **Severe** allergies are red with an icon and a heavy red border. Sorted by delivery day, severe first.
- **Prep check:** a big checkbox per flagged meal, recorded with who and when (`prep_checks`, audited) and updated instantly.
- **Needs attention** at the top: meals that now clash, for example after an allergy was added post-order.
  - The check runs every 15 minutes (`detect_allergy_conflicts`, pg_cron). Ops can also run it with "Check for new conflicts".
  - New conflicts email the **owner and the parent** once each (`allergy_conflict` template).
  - The board shows conflicts live, even before the job runs.

### Dietary roll-up (`/admin/kitchen/dietary`)

- Meals by dietary badge per day (bars plus a day-by-day table).
- Children with each allergy (severe counts called out).
- Meals containing each allergen.
- Children's dietary preferences.
- Bars always print the value next to them, so nothing relies on colour alone.

### Who has paid (`/admin/kitchen/payments`, ops/owner)

- Unpaid and failed family orders, with **Send payment reminder** (`payment_reminder` email with a pay link; at most once per 12 hours).
- Paid family orders.
- School invoices not yet paid (open / overdue).
- The owner's setting decides whether unpaid orders are cooked.

### Labels (`/admin/kitchen/labels`)

- **PDF meal labels** on **Avery 5163** (2" × 4", 10 per sheet; the default) or **Avery 5164** (3⅓" × 4", 6 per sheet), set in Settings → Kitchen.
- **On each label:**
  - child's first name + last initial (or the classroom for unnamed school meals);
  - household or school;
  - meal, delivery date and **use-by date** (delivery + the item's days, default 3);
  - a red warning mark with **CONTAINS** / **MAY CONTAIN**;
  - **"PREPARED ALLERGY-SAFE FOR: …"** when modified;
  - a **severe allergy** border and line;
  - the Smart Cookie logo;
  - the item's optional **reheating / serving note** (Menu → Items).
- One label per meal, per day or for the whole week, with an on-screen preview.
- Made with pdfkit (standard fonts, Latin-1).

### Packing lists (`/admin/kitchen/packing`)

- **Schools:** per school → day → classroom, with meals, allergy-safe count, named children and **bag count** (meals per bag in Settings → Kitchen, default 12).
- **Homes:** per delivery route (zone) → day → household, one bag per order.
- Tick boxes for printing.

### Delivery manifest (`/admin/kitchen/manifest`, ops/owner)

- **Per day:** home stops grouped by zone and ordered by ZIP, then one stop per school.
- **Each stop:** address, delivery notes (or the school's entrance, window and contact), tap-to-call phone, bag count and order numbers.
- **Mark delivered** works from a phone. It records the delivery (`deliveries`, audited), emails the family "Your meals were delivered" (`order_delivered`) once, and marks the order fulfilled when every day is delivered.

### Week lifecycle

- **Auto close:** a week closes at cutoff (`close_due_weeks`, pg_cron every 15 minutes, after subscription auto-fill). Closed weeks still show as the current menu until their last delivery day.
- **Manual close** (owner, step-up).
- **Mark fulfilled** (ops/owner).
- **Late order for one family** (owner only, audited), from the customer's admin page:
  - Pick a week past its cutoff, a number of hours (1–72) and a reason.
  - That family sees the week on their order page and can order until it expires. Everyone else can't.
  - The database enforces it (`_write_family_order` checks `_late_exception_active`).

### Role visibility (enforced in the database, not just hidden)

|                                                                | Kitchen | Ops                 | Owner                    |
| -------------------------------------------------------------- | ------- | ------------------- | ------------------------ |
| This Week (no prices, payment or contact details for kitchen)  | ✅      | ✅ + payment column | ✅                       |
| Cook list, allergy board, dietary roll-up, labels, packing     | ✅      | ✅                  | ✅                       |
| Delivery manifest (addresses, phones), Who has paid, reminders | — (403) | ✅                  | ✅                       |
| Close week early, late-order exceptions                        | —       | —                   | ✅ (step-up for closing) |

- **Kitchen data source:** `fulfillment_lines()`, which has **no price, address, phone, email or ZIP columns** (a test checks the function's signature).
- **Ops/owner data source:** `fulfillment_orders()`, which returns nothing to anyone else.

### Database (`20261127000100_fulfillment.sql`)

- **New tables** (RLS on, audited where relevant):
  - `prep_checks`
  - `deliveries`
  - `allergy_conflict_alerts`
  - `late_order_exceptions`
- **New columns:**
  - `site_settings.kitchen_settings`: exclude unpaid, label sheet, use-by days, meals per bag;
  - `menu_items.reheat_instructions` and `use_by_days`.
- **New functions:**
  - `fulfillment_lines`, `fulfillment_orders`
  - `mark_delivered`, `detect_allergy_conflicts`, `send_payment_reminder`
  - `close_due_weeks`, `close_week_now`, `mark_week_fulfilled`
  - `grant_late_order`, `revoke_late_order`
- **Order function:** the patched `_write_family_order` adds two marked conditions for late orders.
- **Email templates** (owner-editable): `allergy_conflict`, `order_delivered`, `payment_reminder`.

### Bugs found and fixed along the way

- **Admin customer page:** it returned "Page not found" for every customer since Phase 5. Adding `households.default_address_id` made the address lookup ambiguous; it now names the relationship explicitly. Covered by the new late-order test, and a sweep of all 35 admin pages now loads cleanly.
- **Accessibility fixes from the new audit** (details in `docs/compliance.md`):
  - meal art was announced as an unnamed image;
  - the plans comparison table couldn't be scrolled by keyboard;
  - the "can't have this" allergy warning was dimmed below AA contrast.

## How to test

```bash
pnpm db:reset && pnpm db:test
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
pnpm build && pnpm exec playwright test --trace off
```

**With the seed:** sign in as `kitchen@smartcookie.test` (TOTP secret in `docs/phase-3.md`) and open This Week.

- The seed has a family order for Maya P. (severe sesame) and Maple Grove's standing order, 22 a day.
- Print the cook list, the allergy board and the packing lists, and download the labels PDF.
- `ops@smartcookie.test` sees the manifest and Who has paid.

**Results:**

- **Unit tests (Vitest), 160 (12 new in `lib/kitchen/logic.test.ts`):**
  - cook list aggregation and the standard / allergy-modified split;
  - severe, may-contain and override rules;
  - conflicts and unpaid orders left out;
  - CSV formula neutralising;
  - allergy board order;
  - label data (use-by, contains, prepared-safe-for, severe);
  - dietary roll-up, summary, packing bag counts, manifest order.
- **DB tests (pgTAP), 313 (36 new in `phase8.test.sql`):**
  - kitchen sees lines at AAL2 only, never at AAL1, never as a parent;
  - kitchen gets no order-level data and can't read `orders`;
  - the line function has no price, contact or address columns;
  - ops see phone and totals;
  - prep checks: kitchen can record, can't record in another's name, parents can't, audited;
  - deliveries: kitchen can't mark them, ops can, it's idempotent, the order is fulfilled and one email goes out;
  - a conflict after ordering shows live, emails owner + parent once, is cleared by an override and resolved;
  - payment reminders: ops only, not twice in 12 hours;
  - auto close; manual close needs the owner + fresh MFA;
  - late order: refused, then allowed for that family;
  - kitchen can't mark a week fulfilled.
- **E2E tests (Playwright), `e2e/kitchen.spec.ts`:**
  - kitchen sees This Week and the cook list with **no prices, payment column or addresses**, and gets 403 on the manifest and Who has paid;
  - a **severe allergy** is on the allergy board (prep check recorded) and on the **label PDF** (name, "PREPARED ALLERGY-SAFE FOR: Sesame", "SEVERE ALLERGY", CONTAINS line, read from the PDF);
  - an **allergy added after ordering** appears in **Needs attention**, emails owner + parent, and is left off the labels;
  - ops mark a stop delivered **on a phone-sized screen**, the order is fulfilled and the family emailed;
  - **print view**: navigation and buttons hidden, the cook list stays (screenshot attached to the report);
  - owner grants a **late order** on the customer page; that family can open the closed week, another family can't.
- **Accessibility (axe, WCAG 2.2 AA):** zero serious/critical issues on all kitchen screens, the public site, the family area and the school portal, on phone and desktop. Covered by `e2e/a11y-kitchen.spec.ts` and `e2e/a11y-site.spec.ts`.
- **Visual check of print and PDF output:** rendered with `pdftoppm` and reviewed.
  - The Avery 5163 grid lines up.
  - The severe label has its red border and warnings.
  - The cook list PDF has one section per day with modified counts in red.
  - Print CSS hides the sidebar, buttons and toasts.

## Known gaps

- **Ingredient roll-up:** a hook only; it needs structured ingredients per item.
- **Labels for unnamed school meals:** one label per meal (classroom + meal). A "one label per bag" option could cut printing for big classes.
- **Manifest order:** zone then ZIP. No route optimisation or driver assignment.
- **Conflict emails** go out on the 15-minute job (or "Check now"), not on the instant the parent saves the allergy. The board shows the conflict immediately.
- **Delivered emails** are only for families; schools don't get one.
- **Legal / compliance items:** listed in `docs/compliance.md`. Two open items touch the existing plan sign-up (California Automatic Renewal Law): add the minimum term and cancellation method next to "Start this plan", and add an explicit consent checkbox.
