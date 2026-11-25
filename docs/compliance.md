# Compliance checklist (California business, families and children, food)

A working checklist of the laws and standards that apply to Smart Cookie, what the app already does, and what's still open. **This isn't legal advice.** Items marked **Lawyer** need review by Hannah's attorney (and accountant for tax) before launch; Phase 10 writes the final policy pages and the go-live review.

Status key: ✅ done · 🟡 partly done / planned in a named phase · ⚠️ gap to close before launch · **Lawyer** needs a professional decision.

## 1. Accessibility: ADA Title III + California Unruh Civil Rights Act

California courts apply the ADA to websites and apps of businesses that serve the public, and the Unruh Act adds statutory damages per visit, so accessibility claims are common. The accepted technical standard is **WCAG 2.1 AA**; we build to **WCAG 2.2 AA**.

| Requirement                                                                                                               | Status                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated audit, zero serious/critical issues: public site, family area, school portal (phone + desktop), kitchen screens | ✅ `e2e/a11y-site.spec.ts`, `e2e/a11y-kitchen.spec.ts` (axe, WCAG 2.2 AA tags) run in CI                                                                                         |
| Fixes found by the audit                                                                                                  | ✅ decorative meal art hidden from screen readers; plans comparison table scrollable by keyboard; allergy warnings no longer dimmed (contrast); delivered stops no longer dimmed |
| Keyboard use, visible focus, labelled inputs, contrast AA                                                                 | ✅ every phase (CLAUDE.md §7); 375 px mobile checks                                                                                                                              |
| Allergy information never by colour alone                                                                                 | ✅ red plus icon and text ("Sesame (severe)", "CONTAINS: …")                                                                                                                     |
| Respect reduced motion                                                                                                    | ✅ animations off under `prefers-reduced-motion`                                                                                                                                 |
| Printed and PDF kitchen documents readable                                                                                | ✅ large type, high contrast, allergy text spelled out                                                                                                                           |
| **Accessibility statement page** with a contact for problems                                                              | 🟡 Phase 10 (owner-editable page)                                                                                                                                                |
| Manual screen-reader pass (VoiceOver iOS, TalkBack, NVDA)                                                                 | 🟡 Phase 10 QA matrix                                                                                                                                                            |
| Stripe-hosted payment and invoice pages                                                                                   | Stripe maintains their accessibility                                                                                                                                             |

## 2. Privacy: CCPA / CPRA, CalOPPA

| Requirement                                                                                                                                                                               | Status                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy policy linked from every page (CalOPPA), including what we collect, why, who we share with (Stripe, Supabase, Resend, Vercel, Sentry), retention, and how Do Not Track is handled | 🟡 draft `privacy` page exists (seed); final text Phase 10 · **Lawyer**                                                                        |
| Notice at collection (sign-up and child profile forms)                                                                                                                                    | ⚠️ add a short notice + link to the policy on sign-up and the child form (Phase 10)                                                            |
| Right to know / access (data export)                                                                                                                                                      | 🟡 Phase 10 (CLAUDE.md §5.11 requires export; account deletion exists today)                                                                   |
| Right to delete                                                                                                                                                                           | ✅ account deletion in `/account`                                                                                                              |
| "Do Not Sell or Share"                                                                                                                                                                    | ✅ we don't sell or share personal data and use no ad trackers; Phase 10 states this in the policy · **Lawyer** to confirm no link is required |
| CCPA thresholds (revenue / volume)                                                                                                                                                        | **Lawyer**: a small business may be below them, but we follow the rules anyway                                                                 |
| Data minimisation for children                                                                                                                                                            | ✅ first name, last initial, optional grade/classroom, allergies, dietary preferences, notes only; no birthdates, photos or surnames           |
| Schools see only first name, last initial and allergies, after approval                                                                                                                   | ✅ Phase 7 (`school_roster()`); the school can't read the children table                                                                       |
| Kitchen sees only first name, classroom/household and allergies; no prices, addresses or phones                                                                                           | ✅ Phase 8 (`fulfillment_lines()`), tested                                                                                                     |
| Allergy data treated as sensitive (health-related)                                                                                                                                        | ✅ visible to the household, the linked school and kitchen staff only (RLS + tests); never in logs or emails beyond what's needed              |
| Retention (e.g. delete archived child records 24 months after account closure)                                                                                                            | 🟡 Phase 10                                                                                                                                    |

## 3. Children: COPPA, California Age-Appropriate Design Code

| Requirement                                                                                 | Status                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COPPA applies to services directed at children under 13 or that knowingly collect from them | ✅ the service is directed at **parents**; children never have accounts or log in; parents enter all child data · **Lawyer** to confirm wording in the policy |
| CA Age-Appropriate Design Code (AB 2273, largely enjoined in court)                         | ✅ not directed at children; we still apply its spirit: no profiling, no tracking, minimal child data                                                         |
| No marketing to children, no child-facing ads or trackers                                   | ✅                                                                                                                                                            |

## 4. Subscriptions: California Automatic Renewal Law (Bus. & Prof. Code §17600 et seq., amended effective July 2025)

| Requirement                                                                                                                           | Status                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before purchase, show clearly: it renews automatically until cancelled, the amount and frequency, any minimum term, and how to cancel | ✅ Phase 9: an "Automatic renewal" box next to each Start button (amount for the household, frequency, trial, minimum term, how to cancel online or by email). Wording is owner-editable (`sub.arl_*`) |
| Affirmative consent to the renewal terms (separate from general terms)                                                                | ✅ Phase 9: required checkbox; the server refuses to start a plan without it and stores the exact terms + time (`subscriptions.renewal_terms`, `renewal_consent_at`)                                   |
| Acknowledgment email with the terms and how to cancel                                                                                 | ✅ Phase 9 "Plan started" email repeats the stored terms (`{{renewal_terms}}`)                                                                                                                         |
| Cancel online, in the same way you signed up, without obstruction                                                                     | ✅ "Cancel plan" in `/subscription` (ends at period end); no forced retention flow                                                                                                                     |
| Notice before a price change                                                                                                          | 🟡 Phase 6 keeps existing subscribers on their price until the owner chooses; a "price is changing" email isn't built yet (add before the first price change)                                          |
| Annual reminder for yearly plans / notice before a free trial converts                                                                | N/A today (no yearly plans or trials; trial terms already appear in the disclosure if one is added). Monthly plans get a renewal notice (Settings → Email)                                             |

Both former ⚠️ items shipped in Phase 9.

## 5. Food and allergens

| Requirement                                                                                                         | Status                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Top-9 allergens (FALCPA + FASTER Act sesame) listed on every item, plus "may contain"                               | ✅ Phase 3/4                                                             |
| Meals that clash with a child's allergies are blocked; owner-approved exceptions are audited                        | ✅ Phase 5 / CLAUDE.md §6                                                |
| Allergy confirmation at checkout; allergen disclaimer (never "allergen-free")                                       | ✅ Phase 5                                                               |
| Labels: name, CONTAINS line, "PREPARED ALLERGY-SAFE FOR", use-by date, severe flag                                  | ✅ Phase 8 labels (Avery 5163/5164)                                      |
| Allergy added after ordering is caught before cooking, and owner + parent are emailed                               | ✅ Phase 8 "Needs attention"                                             |
| California Retail Food Code / county health permit, food handler and food manager certification, commercial kitchen | **Owner**: business licensing, outside the app                           |
| Proposition 65 warnings (if 10+ employees and a listed chemical is present)                                         | **Lawyer**                                                               |
| Nutrition labelling (generally exempt for small restaurant-style businesses)                                        | **Lawyer**; the menu already shows owner-entered nutrition when provided |
| Sales tax on prepared food                                                                                          | **Accountant**; flat rate or Stripe Tax is configurable, off by default  |

## 6. Payments, email and records

| Requirement                                                                                     | Status                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PCI DSS                                                                                         | ✅ card data never touches our servers (Stripe Payment Element / hosted invoice pages: SAQ-A)                                                                                                                                                       |
| CAN-SPAM / CA anti-spam law: unsubscribe for marketing email, physical address, honest subjects | ✅ Phase 9: optional emails (new menu, order reminders) carry the mailing address (Settings → Email), an unsubscribe link and RFC 8058 one-click headers; preferences at `/account/notifications`. **Owner**: enter a mailing address before launch |
| Receipts and invoices                                                                           | ✅ Stripe receipts; school invoices with PDF                                                                                                                                                                                                        |
| Refund policy shown                                                                             | 🟡 draft `refunds` page; final Phase 10 · **Lawyer**                                                                                                                                                                                                |
| Audit trail for money and allergy decisions                                                     | ✅ append-only audit log                                                                                                                                                                                                                            |

## 7. Pages needed before launch (Phase 10)

- Privacy policy (CCPA/CalOPPA, children's data section)
- Terms of service (including subscription terms per the Automatic Renewal Law)
- Refund and cancellation policy
- Allergy policy (exists as a draft)
- Accessibility statement and contact
- Notice at collection (short, on forms)

All are owner-editable CMS pages; drafts are seeded for review, and **none should go live without a lawyer's review**.
