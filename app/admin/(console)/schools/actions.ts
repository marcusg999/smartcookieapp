"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OPS, OWNER } from "@/lib/admin/action";
import { createSchoolInvoice, issueSchoolInvoice, payInvoiceOutOfBand } from "@/lib/payments/school-invoices";
import { standingOrderSchema } from "@/lib/validation/school";

const statusSchema = z.object({ id: z.uuid(), status: z.enum(["approved", "rejected", "suspended", "pending"]) });

export async function setSchoolStatus(input: z.input<typeof statusSchema>) {
  return adminAction(
    { roles: OPS, action: "school.status_changed", schema: statusSchema, input },
    async (d, { user, supabase }) => {
      check(
        await supabase
          .from("organizations")
          .update({ status: d.status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
          .eq("id", d.id),
      );
      revalidatePath("/admin/schools");
      revalidatePath(`/admin/schools/${d.id}`);
      const msg = {
        approved: "School approved. They can now set up standing orders.",
        rejected: "School declined.",
        suspended: "School suspended. Their standing orders won't run.",
        pending: "School moved back to pending.",
      }[d.status];
      return { auditEntity: { type: "organization", id: d.id }, result: { ok: true, message: msg } };
    },
  );
}

const billingSchema = z.object({
  id: z.uuid(),
  billing_email: z.union([z.literal(""), z.email()]),
  billing_terms_days: z.number().int().min(0).max(90),
  tax_exempt: z.boolean(),
  contact_phone: z.string().trim().max(32),
  dropoff_instructions: z.string().trim().max(1000),
});

export async function saveSchoolBilling(input: z.input<typeof billingSchema>) {
  return adminAction(
    { roles: OPS, action: "school.billing_saved", schema: billingSchema, input },
    async ({ id, ...d }, { supabase }) => {
      check(
        await supabase
          .from("organizations")
          .update({
            ...d,
            billing_email: d.billing_email || null,
            contact_phone: d.contact_phone || null,
            dropoff_instructions: d.dropoff_instructions || null,
          })
          .eq("id", id),
      );
      revalidatePath(`/admin/schools/${id}`);
      return { auditEntity: { type: "organization", id }, result: { ok: true, message: "School details saved." } };
    },
  );
}

const classroomSchema = z.object({
  id: z.uuid().optional(),
  organization_id: z.uuid(),
  name: z.string().trim().min(1, "Name the classroom.").max(80),
  teacher_name: z.string().trim().max(80),
  grade: z.string().trim().max(20),
  headcount: z.number().int().min(0).max(1000),
  dropoff_location: z.string().trim().max(200),
});

export async function saveClassroom(input: z.input<typeof classroomSchema>) {
  return adminAction(
    { roles: OPS, action: "school.classroom_saved", schema: classroomSchema, input },
    async ({ id, ...d }, { supabase }) => {
      const row = {
        ...d,
        teacher_name: d.teacher_name || null,
        grade: d.grade || null,
        dropoff_location: d.dropoff_location || null,
      };
      const saved = id
        ? check(await supabase.from("classrooms").update(row).eq("id", id).select("id").single())
        : check(await supabase.from("classrooms").insert(row).select("id").single());
      revalidatePath(`/admin/schools/${d.organization_id}`);
      return { auditEntity: { type: "classroom", id: saved.id }, result: { ok: true, message: "Classroom saved." } };
    },
  );
}

// ─── Phase 7: pricing, standing orders, invoices ────────────────────────────

const pricingSchema = z.object({ id: z.uuid(), use_school_pricing: z.boolean() });

/** The school price list is pricing: owner only, fresh MFA (CLAUDE.md §5.5). */
export async function saveSchoolPricing(input: z.input<typeof pricingSchema>) {
  return adminAction(
    { roles: OWNER, stepUp: true, action: "school.pricing_changed", schema: pricingSchema, input },
    async (d, { supabase }) => {
      check(
        await supabase
          .from("organizations")
          .update({ use_school_pricing: d.use_school_pricing })
          .eq("id", d.id)
          .select("id")
          .single(),
      );
      revalidatePath(`/admin/schools/${d.id}`);
      return {
        auditEntity: { type: "organization", id: d.id },
        result: {
          ok: true,
          message: d.use_school_pricing
            ? "School prices on. Open weeks re-priced."
            : "Standard prices. Open weeks re-priced.",
        },
      };
    },
  );
}

const orgSchema = z.object({ id: z.uuid() });

export async function refreshSchoolOrders(input: z.input<typeof orgSchema>) {
  return adminAction(
    { roles: OPS, action: "school.orders_refreshed", schema: orgSchema, input },
    async (d, { supabase }) => {
      const n = check(await supabase.rpc("refresh_school_orders", { p_org: d.id }));
      revalidatePath(`/admin/schools/${d.id}`);
      return {
        auditEntity: { type: "organization", id: d.id },
        result: { ok: true, message: `Re-planned ${n} open week(s).` },
      };
    },
  );
}

const adminStandingOrderSchema = z.object({ organization_id: z.uuid(), order: standingOrderSchema });

/** Ops/owner view and adjust any school's standing order (re-plans open weeks). */
export async function adminSaveStandingOrder(input: z.input<typeof adminStandingOrderSchema>) {
  return adminAction(
    { roles: OPS, action: "school.standing_order_saved", schema: adminStandingOrderSchema, input },
    async ({ organization_id, order: { id, ...d } }, { supabase, user }) => {
      const row = {
        ...d,
        fixed_quantity: d.quantity_mode === "fixed" ? d.fixed_quantity : null,
        day_items: d.menu_selection_mode === "specific_items" ? d.day_items : {},
        rotation: d.menu_selection_mode === "category_rotation" ? d.rotation : [],
        notes: d.notes || null,
      };
      const saved = id
        ? check(
            await supabase
              .from("standing_orders")
              .update(row)
              .eq("id", id)
              .eq("organization_id", organization_id)
              .select("id")
              .single(),
          )
        : check(
            await supabase
              .from("standing_orders")
              .insert({ ...row, organization_id, created_by: user.id })
              .select("id")
              .single(),
          );
      revalidatePath(`/admin/schools/${organization_id}`);
      return {
        auditEntity: { type: "standing_order", id: saved.id },
        result: { ok: true, message: "Standing order saved. Open weeks re-planned." },
      };
    },
  );
}

const onDemandSchema = z.object({ id: z.uuid(), through: z.iso.date() });

/** Mid-month invoice: everything delivered up to `through` that isn't billed yet. */
export async function generateSchoolInvoice(input: z.input<typeof onDemandSchema>) {
  return adminAction(
    { roles: OPS, action: "school.invoice_generated", schema: onDemandSchema, input },
    async (d, { supabase }) => {
      const id = await createSchoolInvoice(supabase, d.id, "on_demand", {
        start: `${d.through.slice(0, 8)}01`,
        end: d.through,
      });
      revalidatePath(`/admin/schools/${d.id}`);
      if (!id) return { ok: false, error: "validation", message: "Nothing to invoice up to that date." };
      return {
        auditEntity: { type: "invoice", id },
        result: { ok: true, message: "Invoice created in Stripe and emailed to the school." },
      };
    },
  );
}

const invoiceSchema = z.object({ invoice_id: z.uuid() });

/** Finish a draft that didn't reach Stripe (e.g. no billing email at the time). */
export async function retrySchoolInvoice(input: z.input<typeof invoiceSchema>) {
  return adminAction(
    { roles: OPS, action: "school.invoice_retried", schema: invoiceSchema, input },
    async (d, { supabase }) => {
      const { data: inv } = await supabase
        .from("invoices")
        .select("organization_id, status")
        .eq("id", d.invoice_id)
        .single();
      if (!inv || inv.status !== "draft")
        return { ok: false, error: "validation", message: "Only draft invoices can be retried." };
      await issueSchoolInvoice(d.invoice_id);
      revalidatePath(`/admin/schools/${inv.organization_id}`);
      return { auditEntity: { type: "invoice", id: d.invoice_id }, result: { ok: true, message: "Invoice issued." } };
    },
  );
}

const outOfBandSchema = z.object({
  invoice_id: z.uuid(),
  reference: z.string().trim().min(1, "Add the check or PO number.").max(120),
});

/** Check / PO payment: owner, fresh MFA, audited. */
export async function markInvoicePaidOutOfBand(input: z.input<typeof outOfBandSchema>) {
  return adminAction(
    { roles: OWNER, stepUp: true, action: "school.invoice_paid_out_of_band", schema: outOfBandSchema, input },
    async (d, { supabase }) => {
      const { data: inv } = await supabase
        .from("invoices")
        .select("organization_id, status, stripe_invoice_id")
        .eq("id", d.invoice_id)
        .single();
      if (!inv || !["open", "uncollectible"].includes(inv.status as string)) {
        return { ok: false, error: "validation", message: "Only open invoices can be marked paid." };
      }
      await payInvoiceOutOfBand(inv.stripe_invoice_id as string | null, d.invoice_id);
      check(await supabase.rpc("mark_invoice_paid_out_of_band", { p_invoice: d.invoice_id, p_reference: d.reference }));
      revalidatePath(`/admin/schools/${inv.organization_id}`);
      revalidatePath("/admin/schools");
      return { auditEntity: { type: "invoice", id: d.invoice_id }, result: { ok: true, message: "Marked paid." } };
    },
  );
}
