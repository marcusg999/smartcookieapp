"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail } from "@/lib/auth/action-result";
import { adminAction, check, OPS } from "@/lib/admin/action";
import { getPaymentProvider } from "@/lib/payments/provider";

const refundSchema = z
  .object({
    orderId: z.uuid(),
    // Either specific lines (refunded at what was paid for them) or an amount.
    itemIds: z.array(z.uuid()).max(100).default([]),
    amountCents: z.number().int().min(1).max(1_000_000).optional(),
    reason: z.string().trim().min(3, "Give a short reason.").max(300),
  })
  .refine((d) => d.itemIds.length > 0 || d.amountCents, {
    message: "Choose lines or enter an amount.",
    path: ["amountCents"],
  });

/**
 * Refund (Phase 6 §5): ops and owner, with a fresh MFA step-up. The amount is
 * computed here from the order's lines (never trusted from the browser when
 * lines are chosen). RLS on order_refunds is the final gate: it enforces the
 * step-up, the ops per-refund limit and "no more than was collected".
 */
export async function refundOrder(input: z.input<typeof refundSchema>) {
  return adminAction(
    { roles: OPS, stepUp: true, action: "order.refunded", schema: refundSchema, input },
    async (d, { user, supabase }) => {
      let amount = d.amountCents ?? 0;
      if (d.itemIds.length) {
        const { data: items } = await supabase
          .from("order_items")
          .select("id, quantity, unit_price_cents")
          .eq("order_id", d.orderId)
          .in("id", d.itemIds);
        amount = (items ?? []).reduce((s, i) => s + i.quantity * i.unit_price_cents, 0);
        if (amount <= 0)
          return fail("validation", "Those lines were included in a plan, so there's nothing to refund.");
      }
      const { data: row, error } = await supabase
        .from("order_refunds")
        .insert({
          order_id: d.orderId,
          amount_cents: amount,
          reason: d.reason,
          order_item_ids: d.itemIds,
          requested_by: user.id,
        })
        .select("id")
        .single();
      if (error) {
        return fail(
          "validation",
          error.code === "42501"
            ? "That's over your refund limit or more than this order has left to refund."
            : "We couldn't record that refund.",
        );
      }
      try {
        // Service role inside the provider: Stripe refunds are sent by the
        // server; the RLS insert above already proved who may refund what.
        await getPaymentProvider().executeRefund(row.id as string);
      } catch (e) {
        console.error("refund failed", { message: (e as Error).message });
        return fail("unknown", "Stripe didn't accept the refund. Nothing was refunded; check the order in Stripe.");
      }
      revalidatePath(`/admin/orders/${d.orderId}`);
      revalidatePath("/admin/orders");
      return {
        auditEntity: { type: "order", id: d.orderId },
        result: { ok: true, message: `Refunded $${(amount / 100).toFixed(2)}.` },
      };
    },
  );
}

/** Ask Stripe again for an order's payment state (if a webhook was missed). */
export async function refreshPayment(input: { orderId: string }) {
  return adminAction(
    { roles: OPS, action: "order.payment_refreshed", schema: z.object({ orderId: z.uuid() }), input },
    async (d, { supabase }) => {
      check(await supabase.from("orders").select("id").eq("id", d.orderId).single());
      await getPaymentProvider().reconcile(d.orderId);
      revalidatePath(`/admin/orders/${d.orderId}`);
      return { auditEntity: { type: "order", id: d.orderId }, result: { ok: true, message: "Checked with Stripe." } };
    },
  );
}
