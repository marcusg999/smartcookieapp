import { describe, expect, it } from "vitest";

import { estimateStripeFeeCents, monthlyValueCents, paymentStatus } from "./payment-status";

describe("paymentStatus", () => {
  const base = { amount_paid_cents: 0, amount_refunded_cents: 0 };
  it("maps order + Stripe state to who-has-paid", () => {
    expect(paymentStatus({ ...base, status: "pending_payment" })).toBe("pending");
    expect(paymentStatus({ ...base, status: "pending_payment", payment_failed_at: "2026-11-20T00:00:00Z" })).toBe(
      "failed",
    );
    expect(paymentStatus({ ...base, status: "paid", amount_paid_cents: 2000 })).toBe("paid");
    expect(paymentStatus({ status: "paid", amount_paid_cents: 2000, amount_refunded_cents: 500 })).toBe(
      "partially_refunded",
    );
    expect(paymentStatus({ status: "refunded", amount_paid_cents: 2000, amount_refunded_cents: 2000 })).toBe(
      "refunded",
    );
    expect(paymentStatus({ ...base, status: "cancelled" })).toBe("cancelled");
  });
  it("marks school invoices overdue after the due date", () => {
    expect(paymentStatus({ ...base, status: "invoiced", invoice_due_date: "2026-11-01", today: "2026-11-22" })).toBe(
      "overdue",
    );
    expect(paymentStatus({ ...base, status: "invoiced", invoice_due_date: "2026-12-01", today: "2026-11-22" })).toBe(
      "invoiced",
    );
  });
});

describe("revenue helpers", () => {
  it("estimates Stripe card fees (2.9% + 30¢)", () => {
    expect(estimateStripeFeeCents(10000)).toBe(320);
    expect(estimateStripeFeeCents(0)).toBe(0);
  });
  it("normalises plan prices to monthly", () => {
    expect(monthlyValueCents(3000, 1, "week")).toBe(13000);
    expect(monthlyValueCents(15900, 1, "month")).toBe(15900);
    expect(monthlyValueCents(2550, 2, "week")).toBe(22100);
  });
});
