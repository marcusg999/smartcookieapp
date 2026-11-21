"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OPS } from "@/lib/admin/action";

const noteSchema = z
  .object({
    householdId: z.uuid().optional(),
    organizationId: z.uuid().optional(),
    body: z.string().trim().min(1, "Write a note first.").max(2000),
  })
  .refine((d) => !!d.householdId !== !!d.organizationId);

export async function addCustomerNote(input: z.input<typeof noteSchema>) {
  return adminAction(
    { roles: OPS, action: "customer.note_added", schema: noteSchema, input },
    async (d, { user, supabase }) => {
      const row = check(
        await supabase
          .from("customer_notes")
          .insert({
            household_id: d.householdId ?? null,
            organization_id: d.organizationId ?? null,
            body: d.body,
            author_id: user.id,
          })
          .select("id")
          .single(),
      );
      revalidatePath(d.householdId ? `/admin/customers/${d.householdId}` : `/admin/schools/${d.organizationId}`);
      return { auditEntity: { type: "customer_note", id: row.id }, result: { ok: true, message: "Note added." } };
    },
  );
}

const creditSchema = z.object({
  householdId: z.uuid(),
  amount_cents: z
    .number()
    .int()
    .refine((n) => n !== 0, "Enter an amount.")
    .refine((n) => Math.abs(n) <= 100000, "Credits are capped at $1,000."),
  reason: z.string().trim().min(3, "Say why (for the record).").max(300),
});

// Credits are money: step-up like refunds (CLAUDE.md §5.5).
export async function addAccountCredit(input: z.input<typeof creditSchema>) {
  return adminAction(
    { roles: OPS, stepUp: true, action: "customer.credit_added", schema: creditSchema, input },
    async (d, { user, supabase }) => {
      const row = check(
        await supabase
          .from("account_credits")
          .insert({ household_id: d.householdId, amount_cents: d.amount_cents, reason: d.reason, created_by: user.id })
          .select("id")
          .single(),
      );
      revalidatePath(`/admin/customers/${d.householdId}`);
      return {
        auditEntity: { type: "account_credit", id: row.id },
        result: { ok: true, message: "Credit added to the account." },
      };
    },
  );
}
