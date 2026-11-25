/**
 * Phase 9: every email the app sends. The copy lives in `email_templates`
 * (owner-editable); this catalog says who it's for, whether it can be
 * unsubscribed from, which {{variables}} it may use (anything else is left
 * as typed, never filled in), and which variable the button links to.
 */
export type EmailCategory = "transactional" | "security" | "marketing";
export type EmailAudience = "family" | "school" | "owner";
export type MarketingTopic = "menu_published" | "cutoff_reminders";

export type CatalogEntry = {
  label: string;
  audience: EmailAudience;
  category: EmailCategory;
  /** Marketing emails only: the preference that turns them off. */
  topic?: MarketingTopic;
  variables: string[];
  /** The variable holding the button's link (the label is editable). */
  cta?: string;
  when: string;
};

const FAMILY = ["first_name"];
const ORDER = [...FAMILY, "order_number", "meals", "total", "delivery_dates", "order_url"];
const PLAN = [...FAMILY, "plan_name", "amount", "plan_url"];
const INVOICE = ["school_name", "invoice_number", "period", "amount", "due_date", "invoice_url"];

export const EMAIL_CATALOG: Record<string, CatalogEntry> = {
  order_confirmation: {
    label: "Order confirmed",
    audience: "family",
    category: "transactional",
    variables: [...ORDER, "allergy_recap"],
    cta: "order_url",
    when: "An order is paid (or fully covered by a plan).",
  },
  order_modified: {
    label: "Order updated",
    audience: "family",
    category: "transactional",
    variables: ORDER,
    cta: "order_url",
    when: "A family changes an order before cutoff.",
  },
  order_cancelled: {
    label: "Order cancelled",
    audience: "family",
    category: "transactional",
    variables: ORDER,
    cta: "orders_url",
    when: "A paid order is cancelled.",
  },
  order_refunded: {
    label: "Refund issued",
    audience: "family",
    category: "transactional",
    variables: [...ORDER, "refund_amount"],
    cta: "order_url",
    when: "Money is refunded on an order.",
  },
  order_cutoff_reminder: {
    label: "Menu closes soon (cutoff reminder)",
    audience: "family",
    category: "marketing",
    topic: "cutoff_reminders",
    variables: [...FAMILY, "week_of", "cutoff", "reason_line", "repeat_url", "menu_url"],
    cta: "repeat_url",
    when: "Hours before cutoff (Settings → Email), to families who haven't ordered and subscribers with meals to pick.",
  },
  menu_published: {
    label: "New weekly menu",
    audience: "family",
    category: "marketing",
    topic: "menu_published",
    variables: [...FAMILY, "week_of", "cutoff", "menu_url"],
    cta: "menu_url",
    when: "A weekly menu is published.",
  },
  order_delivered: {
    label: "Delivered",
    audience: "family",
    category: "transactional",
    variables: [...ORDER, "delivery_date"],
    cta: "order_url",
    when: "Ops marks a delivery done.",
  },
  allergy_conflict: {
    label: "Allergy conflict on an upcoming order",
    audience: "family",
    category: "transactional",
    variables: ["child_first_name", "meal", "allergens", "delivery_date", "order_number", "order_url"],
    cta: "order_url",
    when: "A child's allergies now clash with a meal already ordered (also sent to the owner).",
  },
  payment_reminder: {
    label: "Please pay for your order",
    audience: "family",
    category: "transactional",
    variables: [...ORDER, "pay_url"],
    cta: "pay_url",
    when: "Ops sends a payment reminder.",
  },
  subscription_started: {
    label: "Plan started (with renewal terms)",
    audience: "family",
    category: "transactional",
    variables: [...PLAN, "renewal_terms", "renews_on"],
    cta: "plan_url",
    when: "A plan's first payment goes through. Includes the automatic-renewal terms the parent agreed to.",
  },
  subscription_renewal_reminder: {
    label: "Plan renews soon",
    audience: "family",
    category: "transactional",
    variables: [...PLAN, "renews_on"],
    cta: "plan_url",
    when: "Days before a monthly plan renews (Settings → Email).",
  },
  payment_failed: {
    label: "Plan payment failed",
    audience: "family",
    category: "transactional",
    variables: [...FAMILY, "update_card_url"],
    cta: "update_card_url",
    when: "A plan renewal payment fails.",
  },
  subscription_paused: {
    label: "Plan paused",
    audience: "family",
    category: "transactional",
    variables: [...PLAN, "paused_until"],
    cta: "plan_url",
    when: "A plan is paused.",
  },
  subscription_resumed: {
    label: "Plan resumed",
    audience: "family",
    category: "transactional",
    variables: PLAN,
    cta: "order_week_url",
    when: "A paused plan starts again.",
  },
  subscription_cancelled: {
    label: "Plan cancelled",
    audience: "family",
    category: "transactional",
    variables: [...PLAN, "ends_on"],
    cta: "plan_url",
    when: "A plan is set to end (or ends).",
  },
  subscription_autofill: {
    label: "We picked your plan meals",
    audience: "family",
    category: "transactional",
    variables: [...FAMILY, "week_of", "order_number", "meals", "order_url"],
    cta: "order_url",
    when: "Cutoff passed and plan meals were chosen automatically.",
  },
  subscription_autofill_failed: {
    label: "We couldn't pick your plan meals",
    audience: "family",
    category: "transactional",
    variables: [...FAMILY, "week_of"],
    when: "Cutoff passed but no safe meals could be chosen.",
  },
  school_application: {
    label: "New school application (to the owner)",
    audience: "owner",
    category: "transactional",
    variables: ["school_name", "admin_url"],
    cta: "admin_url",
    when: "A school signs up.",
  },
  school_approved: {
    label: "School approved",
    audience: "school",
    category: "transactional",
    variables: ["school_name", "portal_url"],
    cta: "portal_url",
    when: "The owner approves a school.",
  },
  school_week_ready: {
    label: "Next week's school orders are ready",
    audience: "school",
    category: "transactional",
    variables: ["school_name", "week_of", "cutoff", "portal_url"],
    cta: "portal_url",
    when: "Standing orders become next week's orders.",
  },
  school_invoice: {
    label: "Invoice issued",
    audience: "school",
    category: "transactional",
    variables: INVOICE,
    cta: "invoice_url",
    when: "A monthly or mid-month invoice is created.",
  },
  school_invoice_due_soon: {
    label: "Invoice due soon",
    audience: "school",
    category: "transactional",
    variables: INVOICE,
    cta: "invoice_url",
    when: "3 days before an invoice is due.",
  },
  school_invoice_reminder: {
    label: "Invoice overdue",
    audience: "school",
    category: "transactional",
    variables: [...INVOICE, "days_overdue"],
    cta: "invoice_url",
    when: "3 and 7 days after an invoice was due.",
  },
  school_invoice_paid: {
    label: "Invoice paid",
    audience: "school",
    category: "transactional",
    variables: INVOICE,
    cta: "billing_url",
    when: "An invoice is paid (card, bank transfer or check).",
  },
  school_staff_added: {
    label: "Added to a school (staff)",
    audience: "school",
    category: "transactional",
    variables: ["school_name", "portal_url"],
    cta: "portal_url",
    when: "A school admin adds someone who already has an account. (New people get the sign-up invitation.)",
  },
  owner_cutoff_digest: {
    label: "Cutoff digest (to the owner)",
    audience: "owner",
    category: "transactional",
    variables: ["week_of", "orders", "meals", "unpaid", "attention", "admin_week_url"],
    cta: "admin_week_url",
    when: "Each week closes at cutoff.",
  },
  owner_payments_summary: {
    label: "Payments needing attention (to the owner)",
    audience: "owner",
    category: "transactional",
    variables: ["failed_orders", "past_due_plans", "overdue_invoices", "overdue_amount", "admin_payments_url"],
    cta: "admin_payments_url",
    when: "Daily, only when something needs attention.",
  },
  security_role_granted: {
    label: "Security: staff role granted",
    audience: "owner",
    category: "security",
    variables: ["staff_email", "role", "granted_by", "admin_staff_url"],
    cta: "admin_staff_url",
    when: "Anyone is given the kitchen, ops or owner role.",
  },
  security_new_device: {
    label: "Security: new device sign-in",
    audience: "owner",
    category: "security",
    variables: ["device", "signed_in_at", "account_url"],
    cta: "account_url",
    when: "An owner account signs in from a device it hasn't used before.",
  },
};

/** Variables every email may use. */
export const GLOBAL_VARIABLES = ["business_name"];

export function allowedVariables(key: string): Set<string> {
  return new Set([
    ...GLOBAL_VARIABLES,
    ...(EMAIL_CATALOG[key]?.variables ?? []),
    ...(EMAIL_CATALOG[key]?.cta ? [EMAIL_CATALOG[key]!.cta!] : []),
  ]);
}

/** Sample values for previews and test sends. */
export const SAMPLE_VARIABLES: Record<string, string> = {
  business_name: "Smart Cookie",
  first_name: "Priya",
  order_number: "SC-2026-001042",
  meals: "Maya · Mon · Baked mac & cheese\nMaya · Wed · Turkey & avocado wrap\nLeo · Mon · Veggie pasta salad",
  total: "$27.45",
  delivery_dates: "Mon, Nov 30 and Wed, Dec 2",
  allergy_recap: "Maya: sesame (severe). Leo: no allergies.",
  order_url: "https://smartcookie.example/orders/123",
  orders_url: "https://smartcookie.example/orders",
  refund_amount: "$9.25",
  week_of: "Nov 30",
  cutoff: "Thu, Nov 26, 6:00 PM PST",
  reason_line: "You haven't ordered for this week yet.",
  repeat_url: "https://smartcookie.example/r/sample",
  menu_url: "https://smartcookie.example/order",
  order_week_url: "https://smartcookie.example/order",
  delivery_date: "Monday, Nov 30",
  child_first_name: "Maya",
  meal: "Peanut noodle bowl",
  allergens: "Peanuts",
  pay_url: "https://smartcookie.example/checkout?order=123",
  plan_name: "3 Lunches / week / child",
  amount: "$99.00",
  plan_url: "https://smartcookie.example/subscription",
  renewal_terms:
    "Renews every month at $99.00 until you cancel. Minimum 2 months. Cancel any time from your plan page.",
  renews_on: "Dec 28",
  paused_until: "Dec 14",
  ends_on: "Dec 28",
  update_card_url: "https://smartcookie.example/subscription?billing=1",
  school_name: "Maple Grove Elementary",
  invoice_number: "SC-0042",
  period: "Nov 1 – Nov 30, 2026",
  due_date: "Dec 31, 2026",
  invoice_url: "https://invoice.stripe.com/i/sample",
  billing_url: "https://smartcookie.example/school/billing",
  days_overdue: "3",
  portal_url: "https://smartcookie.example/school",
  admin_url: "https://smartcookie.example/admin/schools/123",
  orders: "42",
  meals_count: "318",
  unpaid: "2",
  attention: "1",
  admin_week_url: "https://smartcookie.example/admin",
  failed_orders: "2",
  past_due_plans: "1",
  overdue_invoices: "1",
  overdue_amount: "$1,240.00",
  admin_payments_url: "https://smartcookie.example/admin/kitchen/payments",
  staff_email: "new.cook@example.com",
  role: "kitchen",
  granted_by: "Hannah",
  admin_staff_url: "https://smartcookie.example/admin/staff",
  device: "Safari on iPhone",
  signed_in_at: "Thu, Nov 26, 9:14 AM PST",
  account_url: "https://smartcookie.example/account",
};
