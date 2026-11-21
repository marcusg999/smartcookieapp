"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OPS } from "@/lib/admin/action";

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
