import type { ContentDef, ContentGroup } from "./registry.ts";

// Phase 9: email-related copy. Values live in content_blocks (seeded from
// these defaults) and are edited in /admin/content. Placeholders in {braces}
// are filled in by the app and must be kept. The emails themselves are
// edited in Content → Emails.
const t = (key: string, def: string, label: string): ContentDef => ({ key, label, type: "text", default: def });

export const EMAIL_CONTENT_GROUPS: ContentGroup[] = [
  {
    id: "email_bits",
    label: "Emails: shared wording",
    items: [
      t(
        "email.footer.transactional",
        "You're getting this because you have an account with us. It's about your orders, so it can't be turned off.",
        "Footer: account emails",
      ),
      t(
        "email.footer.security",
        "Security notice for your account. If this wasn't you, change your password and contact us.",
        "Footer: security notices",
      ),
      t(
        "email.footer.menu_published",
        "You're getting this because you asked to hear about new menus.",
        "Footer: new menu emails",
      ),
      t(
        "email.footer.cutoff_reminders",
        "You're getting this because you asked for order reminders.",
        "Footer: reminder emails",
      ),
      t("email.footer.unsubscribe", "Unsubscribe from these emails", "Unsubscribe link"),
      t("email.reason.not_ordered", "You haven't ordered for this week yet.", "Reminder reason: no order"),
      t(
        "email.reason.allowance_left",
        "Your plan still has meals to pick this week.",
        "Reminder reason: plan meals left",
      ),
      t("email.severe", "severe", "Allergy recap: severe"),
      t("email.no_allergies", "no allergies on file", "Allergy recap: none"),
      t("email.role.kitchen", "kitchen", "Role name: kitchen"),
      t("email.role.ops", "operations", "Role name: ops"),
      t("email.role.owner", "owner", "Role name: owner"),
      t(
        "email.renewal_terms_fallback",
        "Your plan renews automatically until you cancel. You can cancel any time on your Plan page.",
        "Renewal terms (if none were saved)",
      ),
    ],
  },
  {
    id: "email_prefs",
    label: "Account: email preferences",
    items: [
      t("account.notify.title", "Email preferences", "Account card title"),
      t("account.notify.body", "Choose which optional emails you get.", "Account card text"),
      t("notify.title", "Email preferences", "Page heading"),
      t(
        "notify.intro",
        "Order confirmations, receipts, plan and security emails always come, because they're about your account. These are optional:",
        "Intro",
      ),
      t("notify.menu_published", "New weekly menu", "Option: new menu"),
      t("notify.menu_published_help", "When next week's menu goes up.", "Option help: new menu"),
      t("notify.cutoff_reminders", "Order reminders", "Option: reminders"),
      t(
        "notify.cutoff_reminders_help",
        'A nudge before ordering closes if you haven\'t ordered yet, with a one-tap "repeat last week" link.',
        "Option help: reminders",
      ),
      t("notify.save", "Save preferences", "Save button"),
      t("notify.saved", "Saved.", "Saved message"),
    ],
  },
  {
    id: "email_unsubscribe",
    label: "Unsubscribe page",
    items: [
      t("unsub.title", "Unsubscribe", "Page heading"),
      t("unsub.confirm_menu_published", "Stop emails about new weekly menus?", "Question: new menu"),
      t("unsub.confirm_cutoff_reminders", "Stop order reminder emails?", "Question: reminders"),
      t("unsub.button", "Unsubscribe", "Button"),
      t("unsub.all", "Unsubscribe from all optional emails", "Button: all"),
      t(
        "unsub.done",
        "Done. You won't get these emails any more. Order and account emails will still arrive.",
        "Done message",
      ),
      t("unsub.invalid", "This link isn't valid any more. You can change your emails in your account.", "Invalid link"),
      t("unsub.manage", "Manage all email preferences", "Link to preferences"),
    ],
  },
];
