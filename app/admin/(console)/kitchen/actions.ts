"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OPS, OWNER, STAFF } from "@/lib/admin/action";

const done = (message: string, entity?: { type: string; id: string }) => {
  revalidatePath("/admin", "layout");
  return { auditEntity: entity, result: { ok: true as const, message } };
};

const prepSchema = z.object({ order_item_id: z.uuid(), checked: z.boolean() });

/** "Prepared allergy-safe" confirmation for one flagged meal (kitchen, ops, owner). */
export async function setPrepCheck(input: z.input<typeof prepSchema>) {
  return adminAction(
    { roles: STAFF, action: "kitchen.prep_check", schema: prepSchema, input },
    async (d, { supabase, user }) => {
      if (d.checked) {
        const { error } = await supabase
          .from("prep_checks")
          .insert({ order_item_id: d.order_item_id, checked_by: user.id });
        if (error && error.code !== "23505") throw error;
      } else {
        check(await supabase.from("prep_checks").delete().eq("order_item_id", d.order_item_id));
      }
      return done(d.checked ? "Prep check recorded." : "Prep check cleared.", {
        type: "order_item",
        id: d.order_item_id,
      });
    },
  );
}

const deliveredSchema = z.object({
  order_ids: z.array(z.uuid()).min(1).max(200),
  date: z.iso.date(),
  delivered: z.boolean(),
});

/** Ops marks a stop delivered from the manifest (emails the family). */
export async function markDelivered(input: z.input<typeof deliveredSchema>) {
  return adminAction(
    { roles: OPS, action: "kitchen.delivered", schema: deliveredSchema, input },
    async (d, { supabase }) => {
      check(await supabase.rpc("mark_delivered", { p_orders: d.order_ids, p_date: d.date, p_delivered: d.delivered }));
      return done(d.delivered ? "Marked delivered." : "Delivery undone.", { type: "order", id: d.order_ids[0]! });
    },
  );
}

const orderSchema = z.object({ order_id: z.uuid() });

export async function sendPaymentReminder(input: z.input<typeof orderSchema>) {
  return adminAction(
    { roles: OPS, action: "kitchen.payment_reminder", schema: orderSchema, input },
    async (d, { supabase }) => {
      check(await supabase.rpc("send_payment_reminder", { p_order: d.order_id }));
      return done("Reminder queued. It goes out within 15 minutes.", { type: "order", id: d.order_id });
    },
  );
}

export async function runConflictCheck(input: Record<string, never> = {}) {
  return adminAction(
    { roles: OPS, action: "kitchen.conflict_check", schema: z.object({}), input },
    async (_d, { supabase }) => {
      const n = check(await supabase.rpc("detect_allergy_conflicts")) as number;
      return done(n ? `${n} new conflict(s) found. The owner and parents are being emailed.` : "No new conflicts.");
    },
  );
}

const weekSchema = z.object({ week_id: z.uuid() });

/** Close a week before its cutoff: owner, fresh MFA (CLAUDE.md §5.5). */
export async function closeWeekNow(input: z.input<typeof weekSchema>) {
  return adminAction(
    { roles: OWNER, stepUp: true, action: "kitchen.week_closed", schema: weekSchema, input },
    async (d, { supabase }) => {
      check(await supabase.rpc("close_week_now", { p_week: d.week_id }));
      return done("Week closed. Plan meals were auto-filled first.", { type: "menu_week", id: d.week_id });
    },
  );
}

export async function markWeekFulfilled(input: z.input<typeof weekSchema>) {
  return adminAction(
    { roles: OPS, action: "kitchen.week_fulfilled", schema: weekSchema, input },
    async (d, { supabase }) => {
      const n = check(await supabase.rpc("mark_week_fulfilled", { p_week: d.week_id })) as number;
      return done(`Week marked fulfilled (${n} order(s)).`, { type: "menu_week", id: d.week_id });
    },
  );
}

const lateSchema = z.object({
  week_id: z.uuid(),
  household_id: z.uuid(),
  reason: z.string().trim().min(3, "Add a short reason.").max(300),
  hours: z.number().int().min(1).max(72),
});

/** Owner-only late-order exception for one family (audited). */
export async function grantLateOrder(input: z.input<typeof lateSchema>) {
  return adminAction(
    { roles: OWNER, action: "kitchen.late_order_granted", schema: lateSchema, input },
    async (d, { supabase }) => {
      const id = check(
        await supabase.rpc("grant_late_order", {
          p_week: d.week_id,
          p_household: d.household_id,
          p_reason: d.reason,
          p_hours: d.hours,
        }),
      ) as string;
      return done(`Late order allowed for ${d.hours} hour(s). The family can order from their account now.`, {
        type: "late_order_exception",
        id,
      });
    },
  );
}

const revokeSchema = z.object({ exception_id: z.uuid() });

export async function revokeLateOrder(input: z.input<typeof revokeSchema>) {
  return adminAction(
    { roles: OWNER, action: "kitchen.late_order_revoked", schema: revokeSchema, input },
    async (d, { supabase }) => {
      check(await supabase.rpc("revoke_late_order", { p_exception: d.exception_id }));
      return done("Late order exception removed.", { type: "late_order_exception", id: d.exception_id });
    },
  );
}
