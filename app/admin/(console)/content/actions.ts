"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { fail } from "@/lib/auth/action-result";
import { TAGS } from "@/lib/content/content";
import { contentDef } from "@/lib/content/registry";
import { contentValueSchema } from "@/lib/content/schemas";

const keySchema = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/);

export async function saveContentDraft(input: { key: string; value: unknown }) {
  return adminAction(
    { roles: OWNER, action: "content.draft_saved", schema: z.object({ key: keySchema, value: z.unknown() }), input },
    async ({ key, value }, { supabase }) => {
      const def = contentDef(key);
      if (!def) return fail("validation", "Unknown content block.");
      const parsed = contentValueSchema(def.type, key).safeParse(value);
      if (!parsed.success) return fail("validation", parsed.error.issues[0]?.message ?? "That value isn't valid.");
      const existing = await supabase.from("content_blocks").select("id").eq("key", key).maybeSingle();
      if (existing.data) check(await supabase.from("content_blocks").update({ draft_value: parsed.data }).eq("key", key));
      else check(await supabase.from("content_blocks").insert({ key, type: def.type, description: def.label, draft_value: parsed.data }));
      revalidatePath("/admin/content");
      return { auditEntity: { type: "content_block", id: key }, result: { ok: true, message: "Draft saved. Preview it, then publish." } };
    },
  );
}

/** Publish one block, or every block with a pending draft (keys omitted). */
export async function publishContent(input: { keys?: string[] }) {
  return adminAction(
    { roles: OWNER, action: "content.published", schema: z.object({ keys: z.array(keySchema).max(200).optional() }), input, revalidate: [TAGS.content] },
    async ({ keys }, { supabase }) => {
      let query = supabase.from("content_blocks").select("key, draft_value, published_value").not("draft_value", "is", null);
      if (keys?.length) query = query.in("key", keys);
      const rows = check(await query);
      const pending = rows.filter((r) => JSON.stringify(r.draft_value) !== JSON.stringify(r.published_value));
      for (const r of pending) check(await supabase.from("content_blocks").update({ published_value: r.draft_value }).eq("key", r.key));
      revalidatePath("/admin/content");
      return { result: { ok: true, message: pending.length ? `Published ${pending.length} change${pending.length === 1 ? "" : "s"}. Live in a few seconds.` : "Nothing new to publish." } };
    },
  );
}

export async function discardContentDraft(input: { key: string }) {
  return adminAction({ roles: OWNER, action: "content.draft_discarded", schema: z.object({ key: keySchema }), input }, async ({ key }, { supabase }) => {
    const row = check(await supabase.from("content_blocks").select("published_value").eq("key", key).single());
    check(await supabase.from("content_blocks").update({ draft_value: row.published_value }).eq("key", key));
    revalidatePath("/admin/content");
    return { result: { ok: true, message: "Draft discarded." } };
  });
}

/** Restore an old version as the DRAFT (publish to make it live). */
export async function restoreContentVersion(input: { versionId: string }) {
  return adminAction({ roles: OWNER, action: "content.version_restored", schema: z.object({ versionId: z.uuid() }), input }, async ({ versionId }, { supabase }) => {
    const v = check(await supabase.from("content_versions").select("block_id, value").eq("id", versionId).single());
    check(await supabase.from("content_blocks").update({ draft_value: v.value }).eq("id", v.block_id));
    revalidatePath("/admin/content");
    return { result: { ok: true, message: "Old version restored as a draft. Publish to make it live." } };
  });
}
