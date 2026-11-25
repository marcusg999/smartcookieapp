"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OPS, OWNER } from "@/lib/admin/action";
import { TAGS } from "@/lib/content/content";

const done = (message: string) => {
  revalidatePath("/admin/pilot");
  return { ok: true as const, message };
};

const inviteSchema = z.object({
  email: z.union([z.literal(""), z.email("Enter a valid email, or leave it empty for a code only.")]),
  note: z.string().trim().max(200),
});

/** A founding-family invite: a code, emailed when an address is given. */
export async function createInvite(input: z.input<typeof inviteSchema>) {
  return adminAction(
    { roles: OWNER, action: "pilot.invite_created", schema: inviteSchema, input },
    async (d, { supabase }) => {
      const code = check(
        await supabase.rpc("create_pilot_invite", { p_email: d.email || null, p_note: d.note || null }),
      ) as string;
      return {
        auditEntity: { type: "pilot_invite", id: code },
        result: { ...done(d.email ? `Invitation emailed with code ${code}.` : `New code: ${code}`), data: { code } },
      };
    },
  );
}

const modeSchema = z.object({ on: z.boolean() });
export async function setPilotMode(input: z.input<typeof modeSchema>) {
  return adminAction(
    { roles: OWNER, action: "pilot.mode_changed", schema: modeSchema, input, revalidate: [TAGS.settings] },
    async (d, { supabase }) => {
      check(await supabase.from("site_settings").update({ pilot_mode: d.on }).eq("id", true));
      return {
        auditEntity: { type: "site_settings", id: "pilot_mode" },
        result: done(
          d.on ? "Pilot mode is on: sign-up needs an invite code." : "Pilot mode is off: anyone can sign up.",
        ),
      };
    },
  );
}

const householdSchema = z.object({ householdId: z.uuid(), pilot: z.boolean() });
export async function setHouseholdPilot(input: z.input<typeof householdSchema>) {
  return adminAction(
    { roles: OWNER, action: "pilot.household_changed", schema: householdSchema, input },
    async (d, { supabase }) => {
      check(await supabase.rpc("set_household_pilot", { p_household: d.householdId, p_pilot: d.pilot }));
      return {
        auditEntity: { type: "household", id: d.householdId },
        result: done(d.pilot ? "Added to the pilot." : "Removed from the pilot."),
      };
    },
  );
}

const targetsSchema = z.object({
  reorder_week2_pct: z.number().int().min(0).max(100),
  median_repeat_seconds: z.number().int().min(5).max(3600),
  max_allergy_incidents: z.number().int().min(0).max(100),
  allergy_incidents_recorded: z.number().int().min(0).max(1000),
});
export async function savePilotTargets(input: z.input<typeof targetsSchema>) {
  return adminAction(
    { roles: OWNER, action: "pilot.targets_saved", schema: targetsSchema, input },
    async (d, { supabase }) => {
      check(await supabase.from("site_settings").update({ pilot_targets: d }).eq("id", true));
      return { auditEntity: { type: "site_settings", id: "pilot_targets" }, result: done("Targets saved.") };
    },
  );
}

const resolveSchema = z.object({ id: z.uuid(), resolved: z.boolean() });
export async function resolveFeedback(input: z.input<typeof resolveSchema>) {
  return adminAction(
    { roles: OPS, action: "feedback.resolved", schema: resolveSchema, input },
    async (d, { supabase, user }) => {
      check(
        await supabase
          .from("feedback")
          .update({
            resolved_at: d.resolved ? new Date().toISOString() : null,
            resolved_by: d.resolved ? user.id : null,
          })
          .eq("id", d.id),
      );
      return {
        auditEntity: { type: "feedback", id: d.id },
        result: done(d.resolved ? "Marked as handled." : "Reopened."),
      };
    },
  );
}
