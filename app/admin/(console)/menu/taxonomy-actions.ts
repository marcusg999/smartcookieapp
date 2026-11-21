"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { slugify } from "@/lib/admin/slug";
import { TAGS } from "@/lib/content/content";

const kinds = { categories: "menu_categories", badges: "dietary_badges", allergens: "allergens" } as const;
type Kind = keyof typeof kinds;

const rowSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Names can't be empty.").max(60),
  icon: z.string().trim().max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #2f6f4f.")
    .optional(),
  is_active: z.boolean().optional(),
  archived: z.boolean().optional(),
});
const schema = z.object({ kind: z.enum(["categories", "badges", "allergens"]), rows: z.array(rowSchema).max(100) });

/** Save the whole list: names, icons/colours, order (array order), new rows and archive flags. */
export async function saveTaxonomy(input: { kind: Kind; rows: z.input<typeof rowSchema>[] }) {
  return adminAction(
    { roles: OWNER, action: `menu.${input.kind}_saved`, schema, input, revalidate: [TAGS.menu] },
    async ({ kind, rows }, { supabase }) => {
      const table = kinds[kind];
      for (const [sort_order, row] of rows.entries()) {
        const base: Record<string, unknown> = { name: row.name, sort_order };
        if (kind !== "categories") {
          base.icon = row.icon || null;
          base.archived_at = row.archived ? new Date().toISOString() : null;
        }
        if (kind === "badges") base.color = row.color ?? null;
        if (kind === "categories") base.is_active = row.is_active ?? true;
        if (row.id) check(await supabase.from(table).update(base).eq("id", row.id));
        else check(await supabase.from(table).insert({ ...base, slug: slugify(row.name).slice(0, 60) }));
      }
      revalidatePath(`/admin/menu/${kind}`);
      return { result: { ok: true, message: "Saved." } };
    },
  );
}
