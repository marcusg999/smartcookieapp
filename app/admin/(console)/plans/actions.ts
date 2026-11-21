"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { slugify } from "@/lib/admin/slug";
import { TAGS } from "@/lib/content/content";
import { ensureProduct, moveSubscriptionsToPrice, planRecurring, replacePrice } from "@/lib/stripe/server";
import { richTextSchema } from "@/lib/validation/rich-text";

const planSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name the plan.").max(80),
  description_rich: richTextSchema.optional(),
  audience: z.enum(["family", "school"]),
  billing_interval: z.enum(["week", "two_weeks", "month"]),
  meals_per_interval: z.number().int().min(1, "At least one meal.").max(100),
  allowance_unit: z.enum(["per_child", "per_household"]),
  price_cents: z.number().int().min(0).max(1_000_000),
  price_per_extra_meal_cents: z.number().int().min(0).max(100_000).nullable(),
  includes_snacks: z.boolean(),
  snacks_per_interval: z.number().int().min(0).max(100),
  allow_skip: z.boolean(),
  max_skips_per_month: z.number().int().min(0).max(31),
  allow_pause: z.boolean(),
  rollover_unused: z.boolean(),
  max_rollover: z.number().int().min(0).max(100),
  auto_fill_strategy: z.enum(["favorites", "chefs_choice", "none"]),
  min_commitment_intervals: z.number().int().min(0).max(52),
  trial_intervals: z.number().int().min(0).max(12),
  is_active: z.boolean(),
  // When the price changes and the plan has subscribers:
  existing_subscribers: z.enum(["keep_old_price", "move_at_renewal"]).default("keep_old_price"),
});

export type PlanInput = z.input<typeof planSchema>;

/** Save a plan and sync it to Stripe. Always needs a fresh step-up ("changing plans", CLAUDE.md §5.5). */
export async function savePlan(input: PlanInput) {
  return adminAction(
    { roles: OWNER, stepUp: true, action: "plan.saved", schema: planSchema, input, revalidate: [TAGS.content] },
    async (data, { supabase }) => {
      const { id: planId, existing_subscribers, ...fields } = data;
      const existing = planId
        ? check(
            await supabase
              .from("plans")
              .select("id, price_cents, billing_interval, stripe_product_id, stripe_price_id, currency")
              .eq("id", planId)
              .single(),
          )
        : null;
      const row = { ...fields, description_rich: fields.description_rich ?? null };

      let id: string;
      if (existing) {
        id = existing.id;
        check(await supabase.from("plans").update(row).eq("id", id));
      } else {
        let slug = slugify(data.name).slice(0, 80);
        const { count } = await supabase
          .from("plans")
          .select("id", { count: "exact", head: true })
          .like("slug", `${slug}%`);
        if (count) slug = `${slug}-${count + 1}`;
        id = (
          check(
            await supabase
              .from("plans")
              .insert({ ...row, slug })
              .select("id")
              .single(),
          ) as { id: string }
        ).id;
      }

      const priceChanged =
        !existing || existing.price_cents !== data.price_cents || existing.billing_interval !== data.billing_interval;
      let moved = 0;
      if (priceChanged) {
        const productId = await ensureProduct({
          productId: existing?.stripe_product_id,
          name: data.name,
          metadata: { plan_id: id },
        });
        const priceId = await replacePrice({
          productId,
          unitAmount: data.price_cents,
          currency: existing?.currency ?? "usd",
          previousPriceId: existing?.stripe_price_id,
          recurring: planRecurring(data.billing_interval),
          metadata: { plan_id: id },
        });
        check(
          await supabase.from("plans").update({ stripe_product_id: productId, stripe_price_id: priceId }).eq("id", id),
        );

        if (existing && existing_subscribers === "move_at_renewal") {
          const subs = check(
            await supabase
              .from("subscriptions")
              .select("stripe_subscription_id")
              .eq("plan_id", id)
              .in("status", ["active", "trialing", "past_due"]),
          );
          moved = await moveSubscriptionsToPrice(
            subs.map((s) => s.stripe_subscription_id).filter((s): s is string => !!s),
            priceId,
          );
        }
      }
      revalidatePath("/admin/plans");
      const message = !priceChanged
        ? "Plan saved."
        : existing
          ? existing_subscribers === "move_at_renewal"
            ? `Saved. ${moved} subscriber(s) will move to the new price at their next renewal (no mid-period charges).`
            : "Saved. New sign-ups get the new price; existing subscribers keep their old price."
          : "Plan created.";
      return { auditEntity: { type: "plan", id }, result: { ok: true, data: { id }, message } };
    },
  );
}
