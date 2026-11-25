"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { slugify } from "@/lib/admin/slug";
import { fail, type ActionResult } from "@/lib/auth/action-result";
import { requireRecentReauth } from "@/lib/auth/guards";
import { TAGS } from "@/lib/content/content";
import { ImageRejected, processUpload } from "@/lib/images/process";
import { archivePrices, createPrice, ensureProduct } from "@/lib/stripe/server";
import { richTextSchema } from "@/lib/validation/rich-text";

const uuid = z.uuid();
const cents = z.number().int().min(0).max(100_000);

const itemSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Give the meal a name.").max(120),
  short_description: z.string().trim().max(200).optional().default(""),
  description_rich: richTextSchema.optional(),
  category_id: uuid.nullable().optional(),
  base_price_cents: cents,
  school_price_cents: cents.nullable(),
  portion_label: z.string().trim().max(60).optional().default(""),
  ingredients: z.string().trim().max(2000).optional().default(""),
  // Phase 8: printed on meal labels.
  reheat_instructions: z.string().trim().max(160).optional().default(""),
  use_by_days: z.number().int().min(1).max(14).nullable().optional().default(null),
  nutrition: z
    .array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(40) }))
    .max(20)
    .default([]),
  is_snack: z.boolean().default(false),
  is_active: z.boolean().default(true),
  badge_ids: z.array(uuid).max(20).default([]),
  allergens: z
    .array(z.object({ allergen_id: uuid, presence: z.enum(["contains", "may_contain"]) }))
    .max(40)
    .default([]),
  confirm_no_allergens: z.boolean().default(false),
});

export type SaveItemResult = ActionResult<{ id: string; priceChanged: boolean }>;

export async function saveMenuItem(input: z.input<typeof itemSchema>): Promise<SaveItemResult> {
  return adminAction(
    { roles: OWNER, action: "menu.item_saved", schema: itemSchema, input, revalidate: [TAGS.menu] },
    async (data, { user, supabase }) => {
      if (data.allergens.length === 0 && !data.confirm_no_allergens) {
        return fail(
          "validation",
          'No allergens are set. Tick "This meal contains none of the listed allergens" to confirm.',
          {
            allergens: "Confirm this meal contains no allergens, or select them.",
          },
        );
      }

      const existing = data.id
        ? check(
            await supabase
              .from("menu_items")
              .select(
                "id, slug, stripe_product_id, stripe_price_id, stripe_school_price_id, base_price_cents, school_price_cents, currency",
              )
              .eq("id", data.id)
              .single(),
          )
        : null;
      const amountChanged =
        !existing ||
        existing.base_price_cents !== data.base_price_cents ||
        existing.school_price_cents !== data.school_price_cents;
      // Also resync when an earlier Stripe call failed and left the ids missing.
      const stripeMissing =
        !!existing &&
        (!existing.stripe_price_id || (data.school_price_cents !== null && !existing.stripe_school_price_id));
      const priceChanged = amountChanged || stripeMissing;

      // Price changes need a fresh MFA step-up (CLAUDE.md §5.5); the database enforces it too.
      if (priceChanged) {
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }

      const row = {
        name: data.name,
        short_description: data.short_description || null,
        description_rich: data.description_rich ?? null,
        category_id: data.category_id ?? null,
        portion_label: data.portion_label || null,
        ingredients: data.ingredients || null,
        reheat_instructions: data.reheat_instructions || null,
        use_by_days: data.use_by_days ?? null,
        nutrition: Object.fromEntries(data.nutrition.map((n) => [n.label, n.value])),
        is_snack: data.is_snack,
        is_active: data.is_active,
        base_price_cents: data.base_price_cents,
        school_price_cents: data.school_price_cents,
      };

      // Stripe first (Prices are immutable): create the new Price(s), then write
      // the amount and the matching ids in ONE update, then archive the old
      // ones. A Stripe failure leaves the database unchanged.
      const syncStripe = async (itemId: string, productId?: string | null) => {
        const product = await ensureProduct({ productId, name: data.name, metadata: { menu_item_id: itemId } });
        const currency = existing?.currency ?? "usd";
        const priceId = await createPrice({
          productId: product,
          unitAmount: data.base_price_cents,
          currency,
          metadata: { menu_item_id: itemId, audience: "families" },
        });
        const schoolPriceId =
          data.school_price_cents === null
            ? null
            : await createPrice({
                productId: product,
                unitAmount: data.school_price_cents,
                currency,
                metadata: { menu_item_id: itemId, audience: "schools" },
              });
        return { stripe_product_id: product, stripe_price_id: priceId, stripe_school_price_id: schoolPriceId };
      };

      let id: string;
      let stripeWarning = false;
      if (!data.id) {
        let slug = slugify(data.name);
        const { data: taken } = await supabase.from("menu_items").select("slug").like("slug", `${slug}%`);
        const used = new Set((taken ?? []).map((t) => t.slug));
        if (used.has(slug)) {
          let n = 2;
          while (used.has(`${slug}-${n}`)) n++;
          slug = `${slug}-${n}`;
        }
        const inserted = check(
          await supabase
            .from("menu_items")
            .insert({ ...row, slug })
            .select("id")
            .single(),
        ) as { id: string };
        id = inserted.id;
        // The item exists now; if Stripe fails it's retried on the next save.
        try {
          check(
            await supabase
              .from("menu_items")
              .update(await syncStripe(id))
              .eq("id", id),
          );
        } catch (error) {
          console.error("stripe sync failed for new menu item", { id, error: (error as Error).message });
          stripeWarning = true;
        }
      } else {
        id = data.id;
        const stripeIds = priceChanged ? await syncStripe(id, existing?.stripe_product_id) : {};
        check(
          await supabase
            .from("menu_items")
            .update({ ...row, ...stripeIds })
            .eq("id", id),
        );
        if (priceChanged) await archivePrices([existing?.stripe_price_id, existing?.stripe_school_price_id]);
      }

      // Badges + allergens replaced in one transaction (never left empty by a failed save).
      check(
        await supabase.rpc("set_menu_item_tags", {
          p_item: id,
          p_badges: data.badge_ids,
          p_allergens: data.allergens,
        }),
      );

      revalidatePath("/admin/menu");
      return {
        auditEntity: { type: "menu_item", id },
        result: {
          ok: true,
          data: { id, priceChanged },
          message: stripeWarning
            ? "Saved, but the payment system didn't update. Save again to retry."
            : amountChanged && existing
              ? "Saved. The new price applies to new orders; existing orders keep their price."
              : "Saved.",
        },
      };
    },
  );
}

const idSchema = z.object({ id: uuid });

export async function archiveMenuItem(input: { id: string }) {
  return adminAction(
    { roles: OWNER, action: "menu.item_archived", schema: idSchema, input, revalidate: [TAGS.menu] },
    async ({ id }, { supabase }) => {
      check(
        await supabase
          .from("menu_items")
          .update({ archived_at: new Date().toISOString(), is_active: false })
          .eq("id", id),
      );
      revalidatePath("/admin/menu");
      return {
        auditEntity: { type: "menu_item", id },
        result: { ok: true, message: "Archived. You can restore it any time." },
      };
    },
  );
}

export async function restoreMenuItem(input: { id: string }) {
  return adminAction(
    { roles: OWNER, action: "menu.item_restored", schema: idSchema, input, revalidate: [TAGS.menu] },
    async ({ id }, { supabase }) => {
      check(await supabase.from("menu_items").update({ archived_at: null }).eq("id", id));
      revalidatePath("/admin/menu");
      return {
        auditEntity: { type: "menu_item", id },
        result: { ok: true, message: "Restored (still hidden until you switch it on)." },
      };
    },
  );
}

export async function deleteMenuItem(input: { id: string }) {
  return adminAction(
    { roles: OWNER, action: "menu.item_deleted", schema: idSchema, input },
    async ({ id }, { supabase }) => {
      const [{ count: ordered }, { count: weeks }, { count: templates }] = await Promise.all([
        supabase.from("order_items").select("id", { count: "exact", head: true }).eq("menu_item_id", id),
        supabase.from("menu_week_items").select("id", { count: "exact", head: true }).eq("menu_item_id", id),
        supabase.from("menu_template_items").select("id", { count: "exact", head: true }).eq("menu_item_id", id),
      ]);
      if ((ordered ?? 0) + (weeks ?? 0) + (templates ?? 0) > 0) {
        return fail(
          "validation",
          "This meal has been ordered or is on a menu, so it can't be deleted. Archive it instead.",
        );
      }
      check(await supabase.from("menu_items").delete().eq("id", id));
      revalidatePath("/admin/menu");
      return { auditEntity: { type: "menu_item", id }, result: { ok: true, message: "Deleted." } };
    },
  );
}

export async function duplicateMenuItem(input: { id: string }): Promise<ActionResult<{ id: string }>> {
  return adminAction(
    { roles: OWNER, stepUp: true, action: "menu.item_duplicated", schema: idSchema, input },
    async ({ id }, { supabase }) => {
      const src = check(await supabase.from("menu_items").select("*").eq("id", id).single());
      const slug = `${src.slug}-copy-${Math.random().toString(36).slice(2, 6)}`;
      const {
        id: _id,
        created_at: _c,
        updated_at: _u,
        stripe_product_id: _p,
        stripe_price_id: _sp,
        stripe_school_price_id: _ssp,
        ...rest
      } = src;
      const copy = check(
        await supabase
          .from("menu_items")
          .insert({ ...rest, name: `Copy of ${src.name}`.slice(0, 120), slug, is_active: false, archived_at: null })
          .select("id")
          .single(),
      );
      const [badges, allergens, images] = await Promise.all([
        supabase.from("menu_item_badges").select("badge_id").eq("menu_item_id", id),
        supabase.from("menu_item_allergens").select("allergen_id, presence").eq("menu_item_id", id),
        supabase
          .from("menu_item_images")
          .select("storage_path, alt_text, sort_order, is_primary")
          .eq("menu_item_id", id),
      ]);
      if (badges.data?.length)
        check(
          await supabase.from("menu_item_badges").insert(badges.data.map((b) => ({ ...b, menu_item_id: copy.id }))),
        );
      if (allergens.data?.length)
        check(
          await supabase
            .from("menu_item_allergens")
            .insert(allergens.data.map((a) => ({ ...a, menu_item_id: copy.id }))),
        );
      if (images.data?.length)
        check(
          await supabase.from("menu_item_images").insert(images.data.map((i) => ({ ...i, menu_item_id: copy.id }))),
        );
      revalidatePath("/admin/menu");
      return {
        auditEntity: { type: "menu_item", id: copy.id },
        result: {
          ok: true,
          data: { id: copy.id },
          message: "Duplicated. The copy is switched off until you're ready.",
        },
      };
    },
  );
}

// ── Images ──────────────────────────────────────────────────────────────────
export async function uploadMenuImage(formData: FormData): Promise<ActionResult<{ id: string; path: string }>> {
  const input = { menu_item_id: formData.get("menu_item_id"), alt_text: formData.get("alt_text") };
  const schema = z.object({
    menu_item_id: uuid,
    alt_text: z.string().trim().min(1, "Describe the photo (alt text).").max(200),
  });
  return adminAction(
    { roles: OWNER, action: "menu.image_uploaded", schema, input, revalidate: [TAGS.menu] },
    async (data, { supabase }) => {
      let processed;
      try {
        processed = await processUpload(formData.get("file") as File);
      } catch (error) {
        if (error instanceof ImageRejected) return fail("validation", error.message, { file: error.message });
        throw error;
      }
      // Uploaded with the owner's own session: Storage RLS allows only the owner at AAL2.
      const up = await supabase.storage
        .from("menu-images")
        .upload(processed.path, processed.data, { contentType: "image/webp", upsert: false });
      if (up.error) return fail("unknown", "The upload didn't go through. Please try again.");
      const { count } = await supabase
        .from("menu_item_images")
        .select("id", { count: "exact", head: true })
        .eq("menu_item_id", data.menu_item_id);
      const row = check(
        await supabase
          .from("menu_item_images")
          .insert({
            menu_item_id: data.menu_item_id,
            storage_path: processed.path,
            alt_text: data.alt_text,
            sort_order: count ?? 0,
            is_primary: !count,
          })
          .select("id")
          .single(),
      );
      revalidatePath(`/admin/menu/${data.menu_item_id}`);
      return {
        auditEntity: { type: "menu_item", id: data.menu_item_id },
        result: { ok: true, data: { id: row.id, path: processed.path }, message: "Photo added." },
      };
    },
  );
}

const imagesSchema = z.object({
  menu_item_id: uuid,
  images: z
    .array(
      z.object({
        id: uuid,
        alt_text: z.string().trim().min(1, "Every photo needs alt text.").max(200),
        is_primary: z.boolean(),
      }),
    )
    .max(20),
});

/** Save order (array order), primary photo and alt text in one go. */
export async function saveMenuImages(input: z.input<typeof imagesSchema>) {
  return adminAction(
    { roles: OWNER, action: "menu.images_updated", schema: imagesSchema, input, revalidate: [TAGS.menu] },
    async (data, { supabase }) => {
      const primary = data.images.findIndex((i) => i.is_primary);
      // Clear the primary flag first (one-primary unique index).
      check(
        await supabase.from("menu_item_images").update({ is_primary: false }).eq("menu_item_id", data.menu_item_id),
      );
      for (const [i, img] of data.images.entries()) {
        check(
          await supabase
            .from("menu_item_images")
            .update({ sort_order: i, alt_text: img.alt_text, is_primary: i === (primary === -1 ? 0 : primary) })
            .eq("id", img.id)
            .eq("menu_item_id", data.menu_item_id),
        );
      }
      return { auditEntity: { type: "menu_item", id: data.menu_item_id } };
    },
  );
}

export async function deleteMenuImage(input: { id: string; menu_item_id: string }) {
  const schema = z.object({ id: uuid, menu_item_id: uuid });
  return adminAction(
    { roles: OWNER, action: "menu.image_deleted", schema, input, revalidate: [TAGS.menu] },
    async (data, { supabase }) => {
      const img = check(
        await supabase
          .from("menu_item_images")
          .select("storage_path")
          .eq("id", data.id)
          .eq("menu_item_id", data.menu_item_id)
          .single(),
      );
      check(await supabase.from("menu_item_images").delete().eq("id", data.id));
      // Only remove the file if no other item (e.g. a duplicate) still uses it.
      const { count } = await supabase
        .from("menu_item_images")
        .select("id", { count: "exact", head: true })
        .eq("storage_path", img.storage_path);
      if (!count && !img.storage_path.startsWith("placeholder:"))
        await supabase.storage.from("menu-images").remove([img.storage_path]);
      revalidatePath(`/admin/menu/${data.menu_item_id}`);
      return {
        auditEntity: { type: "menu_item", id: data.menu_item_id },
        result: { ok: true, message: "Photo removed." },
      };
    },
  );
}
