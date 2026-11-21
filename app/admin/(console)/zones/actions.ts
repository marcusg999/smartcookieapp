"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OPS } from "@/lib/admin/action";
import { fail } from "@/lib/auth/action-result";
import { requireRecentReauth } from "@/lib/auth/guards";
import { TAGS } from "@/lib/content/content";

const zoneSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Name the zone.").max(80),
  zip_codes: z
    .string()
    .transform((s) => [
      ...new Set(
        s
          .split(/[\s,;]+/)
          .map((z) => z.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().regex(/^\d{5}$/, "ZIP codes are 5 digits, separated by commas.")).max(500)),
  fee_cents: z.number().int().min(0).max(100_000),
  free_over_cents: z.number().int().min(0).max(1_000_000).nullable(),
  min_order_cents: z.number().int().min(0).max(1_000_000),
  delivery_weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one delivery day."),
  delivery_window_label: z.string().trim().max(80),
  is_active: z.boolean(),
});

export async function saveZone(input: Omit<z.input<typeof zoneSchema>, "zip_codes"> & { zip_codes: string }) {
  return adminAction(
    { roles: OPS, action: "zone.saved", schema: zoneSchema, input, revalidate: [TAGS.content] },
    async (data, { user, supabase }) => {
      const existing = data.id
        ? check(
            await supabase
              .from("delivery_zones")
              .select("fee_cents, free_over_cents, min_order_cents")
              .eq("id", data.id)
              .single(),
          )
        : null;
      const feeChanged =
        !existing ||
        existing.fee_cents !== data.fee_cents ||
        existing.free_over_cents !== data.free_over_cents ||
        existing.min_order_cents !== data.min_order_cents;
      if (feeChanged) {
        if (!user.roles.includes("owner"))
          return fail("forbidden", "Only the owner can change delivery fees and minimums.");
        const stepUp = requireRecentReauth(user);
        if (stepUp) return stepUp;
      }
      const { id, ...row } = data;
      const saved = id
        ? (check(await supabase.from("delivery_zones").update(row).eq("id", id).select("id").single()) as {
            id: string;
          })
        : (check(await supabase.from("delivery_zones").insert(row).select("id").single()) as { id: string });
      revalidatePath("/admin/zones");
      return { auditEntity: { type: "delivery_zone", id: saved.id }, result: { ok: true, message: "Zone saved." } };
    },
  );
}
