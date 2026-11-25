# Smart Cookie: owner guide

For Hannah. Everything here happens in **Admin** (`/admin`). You'll be asked for the 6-digit code from your authenticator app when you sign in, and again before sensitive changes (prices, plans, refunds, staff, tax).

## Your week

| When                           | What                                                                                                                                                                          | Where                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Early in the week              | Check next week's menu (it's made from your rotation), adjust meals and capacities, then **Publish**. Families with "new menu" emails on get one automatically.               | Menu → Weeks               |
| Before cutoff                  | Families get a reminder the number of hours before cutoff you chose (Settings → Email). Nothing to do.                                                                        | —                          |
| At cutoff (e.g. Thursday 6 pm) | Ordering closes on its own. Plan meals that families didn't pick are chosen for them. You get the **cutoff digest** email: orders, meals, unpaid, anything needing attention. | Your inbox                 |
| Cutoff evening                 | Open **This Week**: check **Needs attention** (allergy changes after ordering, unpaid orders), then print.                                                                    | This Week                  |
| Prep day                       | **Cook list** (totals per meal, allergy-safe batches separate), **Allergy board** (tick each check), **Dietary roll-up**.                                                     | Kitchen                    |
| Packing                        | **Labels** (Avery 5163/5164; allergies in red, use-by date), **Packing lists** per family and per classroom.                                                                  | Kitchen → Labels / Packing |
| Delivery day                   | **Manifest** on your phone: tap each stop as delivered; families get a "delivered" email.                                                                                     | Kitchen → Manifest         |
| After delivery                 | **Who has paid**. Send a payment reminder if needed. Mark the week fulfilled.                                                                                                 | Kitchen → Payments         |
| Daily                          | Glance at the **payments** and **payment check** emails (they only come when something needs you).                                                                            | Your inbox                 |
| Monthly (school invoice day)   | School invoices go out automatically. Record cheques under the school's billing. Overdue reminders are automatic.                                                             | Schools                    |

## Changing what customers see

You never need a developer to change words, photos or prices.

- **Words on the site**: Content (each page section), Content → Pages (About, policies), FAQs, Testimonials (real ones only). Edit, **preview**, then **publish**.
- **Emails**: Content → Emails. Edit the subject, text and button; **Preview** shows light and dark mode; **Send a test to me**. Some emails can't be turned off by families (orders, receipts, security); the optional ones (new menu, reminders) have an unsubscribe link.
- **Photos**: Content → Media (JPEG/PNG/WebP, under 8 MB). Then pick them on a meal or page.
- **Menu**: Menu → Items (name, photo, allergens, may-contain, price), Templates (your Week A/B rotation), Weeks (publish, capacities).
- **Plans and prices**: Plans. Changing a price asks for your code. Existing subscribers keep their price until you choose otherwise.
- **Delivery areas**: Zones (zip codes, fee, free-over, minimum, delivery days and window).
- **Business settings**: Settings (details, logo/colours, cutoff rule, tax, refunds limit for staff, email timing, mailing address, data retention, pilot mode, ordering on/off with a message).

## Allergies (the important part)

- Every meal lists what it **contains** and what it **may contain**. Keep these accurate; they drive every safety check.
- The app **blocks** a meal for a child with a matching allergy. Only you can approve an exception for one child and one meal (it's recorded).
- If a parent adds an allergy after ordering, the order shows in **Needs attention** and is left off the cook list until you deal with it; you and the parent are emailed.
- Allergies are always in red on the cook list, allergy board, labels and packing lists. Never write "allergen-free" anywhere.

## Customers, schools and staff

- **Customers**: search a family to see their kids (with allergies), orders, plan, notes and credits. Give a credit, issue a refund (asks for your code), let them order late for one week, or add them to the pilot.
- **Schools**: approve new schools (set their terms), see standing orders, generate an invoice, record an offline payment.
- **Staff** (owner only): invite someone as **kitchen** (cook list, labels, packing; no prices or contact details), **ops** (orders, customers, schools, delivery, refunds up to your limit) or **owner**. Everyone on staff must set up the authenticator app. You can't remove the last owner.

## The pilot

Admin → **Pilot**: invite founding families by email, see who signed up and ordered, read their feedback (they have a Feedback button), and check your success targets. Turn **pilot mode** off when you're ready to open to everyone.

## Privacy requests

- A family can download their data and delete their account themselves (Account → Privacy). Deleting archives their children's details, which are erased after the retention period in Settings.
- If someone emails you asking for their data or deletion, point them to Account → Privacy, or forward to your developer.

## If something goes wrong

| Problem                              | What to do                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The site is down (uptime alert)      | Check your email/SMS alert, wait 5 minutes, then contact your developer. Take orders by text/email meanwhile and enter them later.                                                                                     |
| Ordering needs to stop now           | Settings → **Ordering off** (with a short message for families). Turn it back on when ready.                                                                                                                           |
| A payment looks wrong                | Check the order in Orders and in your Stripe dashboard. The daily **payment check** email lists stuck or mismatched payments. Don't refund twice: refunds are always made from Admin, not Stripe.                      |
| Someone may have got into an account | Staff: remove their role (Staff). Families: they can reset their password; their sessions end. Tell your developer.                                                                                                    |
| You lost your phone (authenticator)  | Use a recovery code you saved at setup. If you have none, your developer can help restore owner access with the owner bootstrap process.                                                                               |
| An allergy incident                  | Make sure the child is safe. Record it in Admin → Pilot (allergy incidents) during the pilot, check the meal's allergens and the child's profile, and tell your developer so the cause can be traced in the audit log. |

**Your developer contact**: [name, email, phone]. Include what you were doing, the page address and a screenshot.
