"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";

const schema = z
  .object({
    id: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,40}$/, "3–40 letters, numbers, - or _."),
    type: z.enum(["percent", "fixed"]),
    value: z.number().int().positive("Enter a value."),
    max_redemptions: z.number().int().positive().nullable(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    is_active: z.boolean(),
  })
  .refine((d) => d.type !== "percent" || d.value <= 100, {
    path: ["value"],
    message: "A percentage can't be over 100.",
  });

// Discount amounts are price-bearing: owner + step-up (DB trigger enforces it too).
export async function saveDiscount(input: z.input<typeof schema>) {
  return adminAction(
    { roles: OWNER, stepUp: true, action: "discount.saved", schema, input },
    async ({ id, ...d }, { supabase }) => {
      const saved = id
        ? check(await supabase.from("discount_codes").update(d).eq("id", id).select("id").single())
        : check(await supabase.from("discount_codes").insert(d).select("id").single());
      revalidatePath("/admin/discounts");
      return {
        auditEntity: { type: "discount_code", id: saved.id },
        result: { ok: true, message: `Code ${d.code} saved.` },
      };
    },
  );
}

const toggle = z.object({ id: z.uuid(), is_active: z.boolean() });
export async function setDiscountActive(input: z.input<typeof toggle>) {
  return adminAction({ roles: OWNER, action: "discount.toggled", schema: toggle, input }, async (d, { supabase }) => {
    check(await supabase.from("discount_codes").update({ is_active: d.is_active }).eq("id", d.id));
    revalidatePath("/admin/discounts");
    return {
      auditEntity: { type: "discount_code", id: d.id },
      result: { ok: true, message: d.is_active ? "Code turned on." : "Code turned off." },
    };
  });
}
