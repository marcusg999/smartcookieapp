"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/auth/audit";
import { env } from "@/lib/env";
import { check, schoolAction } from "@/lib/school/action";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  allergyCountsSchema,
  bulkOrderSchema,
  classroomSchema,
  closureSchema,
  dayChangeSchema,
  inviteStaffSchema,
  removeStaffSchema,
  reviewLinkSchema,
  schoolDetailsSchema,
  standingOrderSchema,
  weekReviewSchema,
} from "@/lib/validation/school";

const done = (message?: string) => {
  revalidatePath("/school", "layout");
  return { ok: true as const, message };
};

/** School details, billing email and drop-off instructions (onboarding). */
export async function saveSchoolDetails(input: z.input<typeof schoolDetailsSchema>) {
  return schoolAction({ schema: schoolDetailsSchema, input, adminOnly: true }, async (d, { orgId, supabase }) => {
    const { data: existing } = await supabase.from("organizations").select("onboarded_at").eq("id", orgId).single();
    check(
      await supabase
        .from("organizations")
        .update({
          name: d.name,
          billing_email: d.billing_email,
          contact_phone: d.contact_phone || null,
          address: { line1: d.line1, city: d.city, state: d.state, zip: d.zip },
          dropoff_entrance: d.dropoff_entrance || null,
          dropoff_contact: d.dropoff_contact || null,
          dropoff_window: d.dropoff_window || null,
          dropoff_instructions: d.dropoff_instructions || null,
          onboarded_at: existing?.onboarded_at ?? new Date().toISOString(),
        })
        .eq("id", orgId)
        .select("id")
        .single(),
    );
    return done();
  });
}

export async function saveClassroom(input: z.input<typeof classroomSchema>) {
  return schoolAction(
    { schema: classroomSchema, input, adminOnly: true },
    async ({ id, ...d }, { orgId, supabase }) => {
      const row = {
        ...d,
        teacher_name: d.teacher_name || null,
        grade: d.grade || null,
        dropoff_location: d.dropoff_location || null,
      };
      if (id) check(await supabase.from("classrooms").update(row).eq("id", id).select("id").single());
      else
        check(
          await supabase
            .from("classrooms")
            .insert({ ...row, organization_id: orgId })
            .select("id")
            .single(),
        );
      return done();
    },
  );
}

export async function archiveClassroom(input: { id: string }) {
  return schoolAction({ schema: z.object({ id: z.uuid() }), input, adminOnly: true }, async ({ id }, { supabase }) => {
    check(
      await supabase
        .from("classrooms")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .select("id")
        .single(),
    );
    return done();
  });
}

/** Allergy counts for children the school hasn't linked (replaces the set). */
export async function saveAllergyCounts(input: z.input<typeof allergyCountsSchema>) {
  return schoolAction({ schema: allergyCountsSchema, input, adminOnly: true }, async (d, { supabase }) => {
    check(await supabase.from("classroom_allergy_counts").delete().eq("classroom_id", d.classroom_id));
    const rows = d.counts.filter((c) => c.count > 0).map((c) => ({ classroom_id: d.classroom_id, ...c }));
    if (rows.length > 0) check(await supabase.from("classroom_allergy_counts").insert(rows));
    return done();
  });
}

export async function reviewLink(input: z.input<typeof reviewLinkSchema>) {
  return schoolAction({ schema: reviewLinkSchema, input, adminOnly: true }, async (d, { supabase }) => {
    check(await supabase.rpc("review_school_link", { p_child: d.child_id, p_approve: d.approve }));
    return done();
  });
}

export async function saveStandingOrder(input: z.input<typeof standingOrderSchema>) {
  return schoolAction({ schema: standingOrderSchema, input, adminOnly: true }, async ({ id, ...d }, ctx) => {
    const row = {
      ...d,
      fixed_quantity: d.quantity_mode === "fixed" ? d.fixed_quantity : null,
      day_items: d.menu_selection_mode === "specific_items" ? d.day_items : {},
      rotation: d.menu_selection_mode === "category_rotation" ? d.rotation : [],
      notes: d.notes || null,
    };
    // Saving re-plans every open week for this standing order (database trigger).
    const saved = id
      ? check(await ctx.supabase.from("standing_orders").update(row).eq("id", id).select("id").single())
      : check(
          await ctx.supabase
            .from("standing_orders")
            .insert({ ...row, organization_id: ctx.orgId, created_by: ctx.user.id })
            .select("id")
            .single(),
        );
    revalidatePath("/school", "layout");
    return { ok: true as const, data: { id: saved.id as string } };
  });
}

export async function deleteStandingOrder(input: { id: string }) {
  return schoolAction({ schema: z.object({ id: z.uuid() }), input, adminOnly: true }, async ({ id }, { supabase }) => {
    check(await supabase.from("standing_orders").delete().eq("id", id));
    return done();
  });
}

/** Headcount, skip or swap for one day (before cutoff). Staff can do this too. */
export async function changeDay(input: z.input<typeof dayChangeSchema>) {
  return schoolAction({ schema: dayChangeSchema, input }, async (d, { supabase }) => {
    check(
      await supabase.rpc("set_standing_order_day", {
        p_so: d.standing_order_id,
        p_date: d.delivery_date,
        p_headcount: d.headcount,
        p_skip: d.skip,
        p_items: d.items,
        p_note: d.note || null,
        p_clear: d.clear,
      }),
    );
    return done();
  });
}

export async function setClosure(input: z.input<typeof closureSchema>) {
  return schoolAction({ schema: closureSchema, input, adminOnly: true }, async (d, { orgId, supabase }) => {
    check(
      await supabase.rpc("set_school_closure", {
        p_org: orgId,
        p_date: d.date,
        p_reason: d.reason || null,
        p_closed: d.closed,
      }),
    );
    return done();
  });
}

export async function markWeekReviewed(input: z.input<typeof weekReviewSchema>) {
  return schoolAction({ schema: weekReviewSchema, input }, async (d, { orgId, supabase }) => {
    check(await supabase.rpc("mark_school_week_reviewed", { p_org: orgId, p_week: d.menu_week_id }));
    return done();
  });
}

export async function placeBulkOrder(input: z.input<typeof bulkOrderSchema>) {
  return schoolAction({ schema: bulkOrderSchema, input, adminOnly: true }, async (d, { orgId, supabase }) => {
    const id = check(
      await supabase.rpc("create_school_bulk_order", {
        p_org: orgId,
        p_week: d.menu_week_id,
        p_items: d.items,
        p_location: d.location,
        p_notes: d.notes || null,
      }),
    );
    revalidatePath("/school", "layout");
    return { ok: true as const, data: { id: id as string } };
  });
}

export async function cancelBulkOrder(input: { id: string }) {
  return schoolAction({ schema: z.object({ id: z.uuid() }), input, adminOnly: true }, async ({ id }, { supabase }) => {
    check(await supabase.rpc("cancel_school_bulk_order", { p_order: id }));
    return done();
  });
}

/**
 * Invite a teacher or office staff member (school_staff). The message is the
 * same whether or not the email already has an account (no enumeration).
 */
export async function inviteStaff(input: z.input<typeof inviteStaffSchema>) {
  return schoolAction({ schema: inviteStaffSchema, input, adminOnly: true }, async (d, { orgId, supabase, user }) => {
    const { data: org } = await supabase.from("organizations").select("status").eq("id", orgId).single();
    if (org?.status !== "approved") {
      return {
        ok: false as const,
        error: "forbidden" as const,
        message: "You can invite staff once your school is approved.",
      };
    }
    // Service role: looking up / inviting an auth user is an Auth admin
    // operation with no RLS equivalent. The caller was checked above (school
    // admin of an approved school) and grant_role re-checks it in the database.
    const admin = createAdminClient();
    let userId = (await admin.rpc("find_user_id_for_invite", { p_email: d.email })).data as string | null;
    const existing = Boolean(userId);
    if (!userId) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(d.email, {
        redirectTo: new URL("/auth/confirm?next=/school", env.NEXT_PUBLIC_SITE_URL).toString(),
      });
      if (error || !data.user) {
        return {
          ok: false as const,
          error: "unknown" as const,
          message: "We couldn't send the invitation. Please try again.",
        };
      }
      userId = data.user.id;
    }
    const { error } = await supabase.rpc("grant_role", { p_user: userId, p_role: "school_staff", p_org: orgId });
    if (error && error.code !== "23505") throw error;
    // People who already have an account get a "you've been added" email
    // (new people get Supabase's invitation instead). Once per person per school.
    if (existing && !error) {
      await admin.rpc("queue_email", {
        p_template: "school_staff_added",
        p_to: d.email,
        p_payload: {},
        p_dedupe: `school_staff_added:${orgId}:${userId}`,
        p_household: null,
        p_org: orgId,
        p_user: userId,
      });
    }
    await audit("school.staff_invited", { entityType: "organization", entityId: orgId, metadata: { by: user.id } });
    return done();
  });
}

export async function removeStaff(input: z.input<typeof removeStaffSchema>) {
  return schoolAction({ schema: removeStaffSchema, input, adminOnly: true }, async (d, { orgId, supabase }) => {
    check(await supabase.rpc("revoke_role", { p_user: d.user_id, p_role: "school_staff", p_org: orgId }));
    await audit("school.staff_removed", { entityType: "user", entityId: d.user_id, metadata: { organization: orgId } });
    return done();
  });
}
