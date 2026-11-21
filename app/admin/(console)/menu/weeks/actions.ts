"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { fail } from "@/lib/auth/action-result";
import { requireRecentReauth } from "@/lib/auth/guards";
import { TAGS } from "@/lib/content/content";
import { fromZonedInput } from "@/lib/time";

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekItem = z.object({
  menu_item_id: uuid,
  price_override_cents: z.number().int().min(0).max(100_000).nullable(),
  capacity: z.number().int().min(0).max(10_000).nullable(),
  available_for: z.enum(["families", "schools", "both"]),
});

export async function createWeek(input: { week_start: string }) {
  const schema = z.object({ week_start: date });
  return adminAction(
    { roles: OWNER, action: "menu.week_created", schema, input },
    async ({ week_start }, { supabase }) => {
      const [y, m, d] = week_start.split("-").map(Number) as [number, number, number];
      const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (day !== 1) return fail("validation", "Weeks start on a Monday. Pick a Monday.");
      const dates = [0, 1, 2, 3, 4].map((i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
      const row = check(
        await supabase
          .from("menu_weeks")
          .insert({ week_start, delivery_dates: dates, status: "draft" })
          .select("id")
          .single(),
      );
      revalidatePath("/admin/menu/weeks");
      return {
        auditEntity: { type: "menu_week", id: row.id },
        result: { ok: true, data: { id: row.id }, message: "Week created as a draft." },
      };
    },
  );
}

const saveSchema = z.object({
  id: uuid,
  delivery_dates: z.array(date).max(7),
  ordering_opens_at: z.iso.datetime().nullable(),
  cutoff_at: z.iso.datetime().nullable(),
  notes_to_families: z.string().trim().max(2000),
  items: z.array(weekItem).max(80),
});

export async function saveWeek(input: z.input<typeof saveSchema>) {
  return adminAction(
    { roles: OWNER, action: "menu.week_saved", schema: saveSchema, input, revalidate: [TAGS.menu] },
    async (data, { user, supabase }) => {
      const ids = data.items.map((i) => i.menu_item_id);
      if (new Set(ids).size !== ids.length)
        return fail("validation", "A meal is on this week twice. Remove the duplicate.");

      const existing = check(
        await supabase.from("menu_week_items").select("menu_item_id, price_override_cents").eq("menu_week_id", data.id),
      );
      const before = new Map(existing.map((e) => [e.menu_item_id, e.price_override_cents]));
      const priceChanged = data.items.some(
        (i) => (before.get(i.menu_item_id) ?? null) !== i.price_override_cents && i.price_override_cents !== null,
      );
      if (priceChanged) {
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }

      check(
        await supabase
          .from("menu_weeks")
          .update({
            delivery_dates: [...data.delivery_dates].sort(),
            ordering_opens_at: data.ordering_opens_at,
            cutoff_at: data.cutoff_at,
            notes_to_families: data.notes_to_families || null,
          })
          .eq("id", data.id),
      );
      // Replace the item list (order = array order).
      const keep = new Set(ids);
      const removed = existing.filter((e) => !keep.has(e.menu_item_id)).map((e) => e.menu_item_id);
      if (removed.length)
        check(await supabase.from("menu_week_items").delete().eq("menu_week_id", data.id).in("menu_item_id", removed));
      if (data.items.length) {
        check(
          await supabase.from("menu_week_items").upsert(
            data.items.map((i, sort_order) => ({ ...i, sort_order, menu_week_id: data.id })),
            { onConflict: "menu_week_id,menu_item_id" },
          ),
        );
      }
      revalidatePath(`/admin/menu/weeks/${data.id}`);
      return { auditEntity: { type: "menu_week", id: data.id }, result: { ok: true, message: "Week saved." } };
    },
  );
}

const statusSchema = z.object({
  id: uuid,
  status: z.enum(["draft", "scheduled", "published", "closed", "fulfilled"]),
  confirm_zero_allergens: z.boolean().default(false),
});

/** Publishing validates the week (Phase 4 §2). */
export async function setWeekStatus(input: z.input<typeof statusSchema>) {
  return adminAction(
    { roles: OWNER, action: "menu.week_status", schema: statusSchema, input, revalidate: [TAGS.menu] },
    async (data, { supabase }) => {
      if (data.status === "published" || data.status === "scheduled") {
        const week = check(
          await supabase
            .from("menu_weeks")
            .select("id, delivery_dates, ordering_opens_at, week_start")
            .eq("id", data.id)
            .single(),
        );
        const items = check(
          await supabase
            .from("menu_week_items")
            .select("menu_item_id, menu_items(name, is_active, archived_at, menu_item_allergens(allergen_id))")
            .eq("menu_week_id", data.id),
        ) as unknown as {
          menu_items: {
            name: string;
            is_active: boolean;
            archived_at: string | null;
            menu_item_allergens: unknown[];
          } | null;
        }[];
        const { data: cutoff } = await supabase.rpc("menu_week_cutoff", { p_week: data.id });

        if (items.length === 0) return fail("validation", "Add at least one meal before publishing.");
        if (week.delivery_dates.length === 0) return fail("validation", "Pick at least one delivery day.");
        const firstDelivery = [...week.delivery_dates].sort()[0]!;
        const { data: settings } = await supabase.from("site_settings").select("timezone").eq("id", true).single();
        const deliveryStarts = fromZonedInput(`${firstDelivery}T00:00`, settings?.timezone ?? "America/Los_Angeles");
        if (!cutoff || !deliveryStarts || new Date(cutoff as string) >= new Date(deliveryStarts)) {
          return fail("validation", "The ordering cutoff must be before the first delivery day.");
        }
        const inactive = items
          .filter((i) => !i.menu_items?.is_active || i.menu_items.archived_at)
          .map((i) => i.menu_items?.name);
        if (inactive.length)
          return fail("validation", `These meals are switched off or archived: ${inactive.join(", ")}.`);
        const noAllergens = items
          .filter((i) => i.menu_items && i.menu_items.menu_item_allergens.length === 0)
          .map((i) => i.menu_items!.name);
        if (noAllergens.length && !data.confirm_zero_allergens) {
          return fail(
            "validation",
            `Please confirm these meals really contain none of the listed allergens: ${noAllergens.join(", ")}.`,
            {
              confirm_zero_allergens: noAllergens.join(", "),
            },
          );
        }
      }
      check(await supabase.from("menu_weeks").update({ status: data.status }).eq("id", data.id));
      revalidatePath("/admin/menu/weeks");
      revalidatePath(`/admin/menu/weeks/${data.id}`);
      const label = {
        draft: "moved back to draft",
        scheduled: "scheduled",
        published: "published. Families can see it now",
        closed: "closed for orders",
        fulfilled: "marked fulfilled",
      }[data.status];
      return { auditEntity: { type: "menu_week", id: data.id }, result: { ok: true, message: `Week ${label}.` } };
    },
  );
}

async function replaceItems(
  supabase: Parameters<Parameters<typeof adminAction>[1]>[1]["supabase"],
  weekId: string,
  rows: {
    menu_item_id: string;
    price_override_cents: number | null;
    capacity: number | null;
    available_for: string;
    sort_order: number;
  }[],
) {
  check(await supabase.from("menu_week_items").delete().eq("menu_week_id", weekId));
  if (rows.length)
    check(await supabase.from("menu_week_items").insert(rows.map((r) => ({ ...r, menu_week_id: weekId }))));
}

export async function applyTemplate(input: { week_id: string; template_id: string }) {
  const schema = z.object({ week_id: uuid, template_id: uuid });
  return adminAction(
    { roles: OWNER, action: "menu.template_applied", schema, input, revalidate: [TAGS.menu] },
    async (data, { user, supabase }) => {
      const rows = check(
        await supabase
          .from("menu_template_items")
          .select("menu_item_id, price_override_cents, capacity, available_for, sort_order")
          .eq("menu_template_id", data.template_id),
      );
      if (rows.some((r) => r.price_override_cents !== null)) {
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }
      await replaceItems(supabase, data.week_id, rows);
      check(
        await supabase
          .from("menu_weeks")
          .update({ generated_from_template_id: data.template_id })
          .eq("id", data.week_id),
      );
      revalidatePath(`/admin/menu/weeks/${data.week_id}`);
      return {
        auditEntity: { type: "menu_week", id: data.week_id },
        result: { ok: true, message: "Template applied." },
      };
    },
  );
}

export async function copyLastWeek(input: { week_id: string }) {
  const schema = z.object({ week_id: uuid });
  return adminAction(
    { roles: OWNER, action: "menu.week_copied", schema, input, revalidate: [TAGS.menu] },
    async (data, { user, supabase }) => {
      const week = check(await supabase.from("menu_weeks").select("week_start").eq("id", data.week_id).single());
      const prev = await supabase
        .from("menu_weeks")
        .select("id")
        .lt("week_start", week.week_start)
        .order("week_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!prev.data) return fail("validation", "There's no earlier week to copy from.");
      const rows = check(
        await supabase
          .from("menu_week_items")
          .select("menu_item_id, price_override_cents, capacity, available_for, sort_order")
          .eq("menu_week_id", prev.data.id),
      );
      if (rows.some((r) => r.price_override_cents !== null)) {
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }
      await replaceItems(supabase, data.week_id, rows);
      revalidatePath(`/admin/menu/weeks/${data.week_id}`);
      return {
        auditEntity: { type: "menu_week", id: data.week_id },
        result: { ok: true, message: `Copied ${rows.length} meals from the previous week.` },
      };
    },
  );
}

export async function saveAsTemplate(input: { week_id: string; name: string }) {
  const schema = z.object({ week_id: uuid, name: z.string().trim().min(1, "Name the template.").max(80) });
  return adminAction(
    { roles: OWNER, action: "menu.template_saved", schema, input },
    async (data, { user, supabase }) => {
      const rows = check(
        await supabase
          .from("menu_week_items")
          .select("menu_item_id, price_override_cents, capacity, available_for, sort_order")
          .eq("menu_week_id", data.week_id),
      );
      if (rows.some((r) => r.price_override_cents !== null)) {
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }
      const tpl = check(await supabase.from("menu_templates").insert({ name: data.name }).select("id").single());
      if (rows.length)
        check(await supabase.from("menu_template_items").insert(rows.map((r) => ({ ...r, menu_template_id: tpl.id }))));
      revalidatePath("/admin/menu/templates");
      return {
        auditEntity: { type: "menu_template", id: tpl.id },
        result: { ok: true, message: `Saved as template "${data.name}".` },
      };
    },
  );
}

const rotationSchema = z.object({
  template_ids: z.array(uuid).max(12),
  anchor_week: date.nullable(),
  weeks_ahead: z.number().int().min(0).max(12),
});

/** The rotation cycle (A → B → C …) and how far ahead drafts are generated. */
export async function saveRotation(input: z.input<typeof rotationSchema>) {
  return adminAction(
    { roles: OWNER, action: "menu.rotation_saved", schema: rotationSchema, input },
    async (data, { supabase }) => {
      check(
        await supabase.from("menu_templates").update({ rotation_position: null }).not("rotation_position", "is", null),
      );
      for (const [i, id] of data.template_ids.entries()) {
        check(
          await supabase
            .from("menu_templates")
            .update({ rotation_position: i + 1 })
            .eq("id", id),
        );
      }
      check(
        await supabase
          .from("site_settings")
          .update({ rotation_anchor_week: data.anchor_week, rotation_weeks_ahead: data.weeks_ahead })
          .eq("id", true),
      );
      revalidatePath("/admin/menu/templates");
      return { result: { ok: true, message: "Rotation saved." } };
    },
  );
}

export async function generateDraftWeeks() {
  return adminAction(
    { roles: OWNER, action: "menu.rotation_generated", schema: z.object({}), input: {} },
    async (_d, { supabase }) => {
      const { data, error } = await supabase.rpc("generate_rotation_weeks");
      if (error) throw error;
      revalidatePath("/admin/menu/weeks");
      const n = Number(data ?? 0);
      return {
        result: {
          ok: true,
          message: n
            ? `Created ${n} draft week${n === 1 ? "" : "s"}. Review them, then publish.`
            : "All upcoming weeks already exist.",
        },
      };
    },
  );
}

const templateSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  items: z.array(weekItem).max(80),
});

export async function saveTemplate(input: z.input<typeof templateSchema>) {
  return adminAction(
    { roles: OWNER, action: "menu.template_updated", schema: templateSchema, input },
    async (data, { user, supabase }) => {
      const existing = check(
        await supabase
          .from("menu_template_items")
          .select("menu_item_id, price_override_cents")
          .eq("menu_template_id", data.id),
      );
      const before = new Map(existing.map((e) => [e.menu_item_id, e.price_override_cents]));
      if (
        data.items.some(
          (i) => i.price_override_cents !== null && (before.get(i.menu_item_id) ?? null) !== i.price_override_cents,
        )
      ) {
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }
      check(
        await supabase
          .from("menu_templates")
          .update({ name: data.name, description: data.description || null })
          .eq("id", data.id),
      );
      check(await supabase.from("menu_template_items").delete().eq("menu_template_id", data.id));
      if (data.items.length) {
        check(
          await supabase
            .from("menu_template_items")
            .insert(data.items.map((i, sort_order) => ({ ...i, sort_order, menu_template_id: data.id }))),
        );
      }
      revalidatePath("/admin/menu/templates");
      return { auditEntity: { type: "menu_template", id: data.id }, result: { ok: true, message: "Template saved." } };
    },
  );
}

export async function archiveTemplate(input: { id: string }) {
  return adminAction(
    { roles: OWNER, action: "menu.template_archived", schema: z.object({ id: uuid }), input },
    async ({ id }, { supabase }) => {
      check(
        await supabase
          .from("menu_templates")
          .update({ archived_at: new Date().toISOString(), rotation_position: null })
          .eq("id", id),
      );
      revalidatePath("/admin/menu/templates");
      return { auditEntity: { type: "menu_template", id }, result: { ok: true, message: "Template archived." } };
    },
  );
}
