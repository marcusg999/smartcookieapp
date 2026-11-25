/**
 * "Who has paid?" (Phase 6 §5): one payment status per order for the admin,
 * derived from the order's status and what Stripe has reported.
 */
export type PaymentStatus =
  "paid" | "pending" | "failed" | "refunded" | "partially_refunded" | "invoiced" | "overdue" | "cancelled";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  pending: "Pending",
  failed: "Failed",
  refunded: "Refunded",
  partially_refunded: "Part refunded",
  invoiced: "Invoiced",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export function paymentStatus(o: {
  status: string;
  amount_paid_cents: number;
  amount_refunded_cents: number;
  payment_failed_at?: string | null;
  invoice_due_date?: string | null;
  today?: string;
}): PaymentStatus {
  if (o.status === "invoiced") {
    return o.invoice_due_date && o.today && o.invoice_due_date < o.today ? "overdue" : "invoiced";
  }
  if (o.amount_refunded_cents > 0)
    return o.amount_refunded_cents >= o.amount_paid_cents ? "refunded" : "partially_refunded";
  if (o.status === "refunded") return "refunded";
  if (o.status === "partially_refunded") return "partially_refunded";
  if (o.status === "cancelled") return "cancelled";
  if (o.status === "pending_payment") return o.payment_failed_at ? "failed" : "pending";
  return "paid";
}

/** Stripe's standard US card pricing, for an ESTIMATE only (actual fees are in the Stripe dashboard). */
export function estimateStripeFeeCents(chargeCents: number): number {
  return chargeCents > 0 ? Math.round(chargeCents * 0.029) + 30 : 0;
}

/** Monthly recurring revenue from a plan price. */
export function monthlyValueCents(
  priceCents: number,
  quantity: number,
  interval: "week" | "two_weeks" | "month",
): number {
  const perMonth =
    interval === "week" ? (priceCents * 52) / 12 : interval === "two_weeks" ? (priceCents * 26) / 12 : priceCents;
  return Math.round(perMonth * Math.max(quantity, 1));
}
