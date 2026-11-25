import { describe, expect, it } from "vitest";

import { cartLinesSchema, placeOrderSchema } from "./family";

// Phase 6 security: the client can't change what's charged. Checkout inputs
// carry no amounts at all; anything extra a tampered request sends is dropped
// before it reaches the server code, which prices from the database.
describe("checkout inputs carry no money", () => {
  const valid = {
    weekId: "86000000-0000-4000-8000-000000000001",
    fulfillment: "delivery",
    addressId: "ad600000-0000-4000-8000-000000000001",
    allergiesConfirmed: true,
    confirmedChildIds: [],
  };
  it("strips amount, total and price fields from placeOrder input", () => {
    const parsed = placeOrderSchema.parse({ ...valid, amount: 1, total_cents: 1, totalCents: 1, price_cents: 1 });
    expect(Object.keys(parsed)).not.toEqual(
      expect.arrayContaining(["amount", "total_cents", "totalCents", "price_cents"]),
    );
    expect(parsed).not.toHaveProperty("amount");
  });
  it("strips prices from cart lines", () => {
    const [line] = cartLinesSchema.parse([
      {
        childId: valid.weekId,
        menuItemId: valid.weekId,
        deliveryDate: "2032-01-05",
        quantity: 1,
        priceCents: 1,
        unitPriceCents: 1,
      },
    ]);
    expect(line).toEqual({ childId: valid.weekId, menuItemId: valid.weekId, deliveryDate: "2032-01-05", quantity: 1 });
  });
  it("requires the allergy confirmation to be exactly true", () => {
    expect(placeOrderSchema.safeParse({ ...valid, allergiesConfirmed: "yes" }).success).toBe(false);
  });
});
