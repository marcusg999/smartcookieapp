"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { fail } from "@/lib/auth/action-result";
import { ImageRejected, processUpload } from "@/lib/images/process";

export async function uploadMedia(formData: FormData) {
  const schema = z.object({ alt_text: z.string().trim().min(1, "Describe the image (alt text).").max(200) });
  return adminAction({ roles: OWNER, action: "media.uploaded", schema, input: { alt_text: formData.get("alt_text") } }, async (data, { user, supabase }) => {
    let img;
    try {
      img = await processUpload(formData.get("file") as File);
    } catch (e) {
      if (e instanceof ImageRejected) return fail("validation", e.message);
      throw e;
    }
    const up = await supabase.storage.from("media").upload(img.path, img.data, { contentType: "image/webp" });
    if (up.error) return fail("unknown", "The upload didn't go through. Please try again.");
    const row = check(
      await supabase.from("media").insert({ storage_path: img.path, alt_text: data.alt_text, width: img.width, height: img.height, uploaded_by: user.id }).select("id").single(),
    );
    revalidatePath("/admin/content/media");
    return { auditEntity: { type: "media", id: row.id }, result: { ok: true, message: "Image added to the library." } };
  });
}

export async function updateMediaAlt(input: { id: string; alt_text: string }) {
  const schema = z.object({ id: z.uuid(), alt_text: z.string().trim().min(1).max(200) });
  return adminAction({ roles: OWNER, action: "media.alt_updated", schema, input }, async (data, { supabase }) => {
    check(await supabase.from("media").update({ alt_text: data.alt_text }).eq("id", data.id));
    return { auditEntity: { type: "media", id: data.id }, result: { ok: true, message: "Alt text saved." } };
  });
}

/** Safe delete: refuses while the image is used anywhere. */
export async function deleteMedia(input: { id: string }) {
  return adminAction({ roles: OWNER, action: "media.deleted", schema: z.object({ id: z.uuid() }), input }, async ({ id }, { supabase }) => {
    const m = check(await supabase.from("media").select("storage_path").eq("id", id).single());
    const { data: uses } = await supabase.rpc("media_usage_count", { p_path: m.storage_path });
    if (Number(uses ?? 0) > 0) return fail("validation", `This image is used in ${uses} place(s). Replace it there first.`);
    check(await supabase.from("media").delete().eq("id", id));
    await supabase.storage.from("media").remove([m.storage_path]);
    revalidatePath("/admin/content/media");
    return { auditEntity: { type: "media", id }, result: { ok: true, message: "Image deleted." } };
  });
}
