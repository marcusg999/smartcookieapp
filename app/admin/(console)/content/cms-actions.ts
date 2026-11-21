"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, check, OWNER } from "@/lib/admin/action";
import { slugify } from "@/lib/admin/slug";
import { TAGS } from "@/lib/content/content";
import { richTextSchema } from "@/lib/validation/rich-text";

// ── Pages ───────────────────────────────────────────────────────────────────
const RESERVED = new Set(["admin", "api", "account", "menu", "cart", "checkout", "orders", "favorites", "subscription", "children", "school", "sign-in", "sign-up", "auth", "forgot-password", "reset-password"]);

const pageSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Give the page a title.").max(120),
  slug: z.string().trim().max(80).optional(),
  seo_title: z.string().trim().max(70),
  seo_description: z.string().trim().max(200),
  og_image: z.string().trim().max(300),
  body: richTextSchema,
  publish: z.boolean().default(false),
});

export async function savePage(input: z.input<typeof pageSchema>) {
  return adminAction({ roles: OWNER, action: "page.saved", schema: pageSchema, input, revalidate: [TAGS.pages] }, async (data, { supabase }) => {
    const slug = slugify(data.slug || data.title).slice(0, 80);
    if (RESERVED.has(slug)) return { result: { ok: false, error: "validation", message: `"/${slug}" is already used by the app. Pick another link.`, fieldErrors: { slug: "Reserved" } } as const };
    const row = {
      title: data.title,
      slug,
      seo_title: data.seo_title || null,
      seo_description: data.seo_description || null,
      og_image: data.og_image || null,
      body_draft: data.body,
      ...(data.publish ? { body_published: data.body, is_published: true, published_at: new Date().toISOString() } : {}),
    };
    const saved = data.id
      ? (check(await supabase.from("pages").update(row).eq("id", data.id).select("id").single()) as { id: string })
      : (check(await supabase.from("pages").insert(row).select("id").single()) as { id: string });
    revalidatePath("/admin/content/pages");
    return { auditEntity: { type: "page", id: saved.id }, result: { ok: true, data: { id: saved.id, slug }, message: data.publish ? `Published at /${slug}.` : "Draft saved." } };
  });
}

export async function unpublishPage(input: { id: string }) {
  return adminAction({ roles: OWNER, action: "page.unpublished", schema: z.object({ id: z.uuid() }), input, revalidate: [TAGS.pages] }, async ({ id }, { supabase }) => {
    check(await supabase.from("pages").update({ is_published: false }).eq("id", id));
    revalidatePath("/admin/content/pages");
    return { auditEntity: { type: "page", id }, result: { ok: true, message: "Page hidden from the site." } };
  });
}

// ── FAQs and testimonials (save the whole list) ─────────────────────────────
const faqSchema = z.object({
  rows: z.array(z.object({ id: z.uuid().optional(), question: z.string().trim().min(3).max(300), answer: richTextSchema, category: z.string().trim().max(60), is_published: z.boolean() })).max(100),
  deleted: z.array(z.uuid()).max(100),
});

export async function saveFaqs(input: z.input<typeof faqSchema>) {
  return adminAction({ roles: OWNER, action: "faqs.saved", schema: faqSchema, input, revalidate: [TAGS.faqs] }, async ({ rows, deleted }, { supabase }) => {
    if (deleted.length) check(await supabase.from("faqs").delete().in("id", deleted));
    for (const [sort_order, r] of rows.entries()) {
      const row = { question: r.question, answer_rich: r.answer, category: r.category || null, is_published: r.is_published, sort_order };
      if (r.id) check(await supabase.from("faqs").update(row).eq("id", r.id));
      else check(await supabase.from("faqs").insert(row));
    }
    revalidatePath("/admin/content/faqs");
    return { result: { ok: true, message: "FAQs saved." } };
  });
}

const testimonialSchema = z.object({
  rows: z.array(z.object({ id: z.uuid().optional(), quote: z.string().trim().min(3).max(600), attribution: z.string().trim().min(1).max(120), is_published: z.boolean() })).max(100),
  deleted: z.array(z.uuid()).max(100),
});

export async function saveTestimonials(input: z.input<typeof testimonialSchema>) {
  return adminAction({ roles: OWNER, action: "testimonials.saved", schema: testimonialSchema, input, revalidate: [TAGS.content] }, async ({ rows, deleted }, { supabase }) => {
    if (deleted.length) check(await supabase.from("testimonials").delete().in("id", deleted));
    for (const [sort_order, r] of rows.entries()) {
      const row = { quote: r.quote, attribution: r.attribution, is_published: r.is_published, sort_order };
      if (r.id) check(await supabase.from("testimonials").update(row).eq("id", r.id));
      else check(await supabase.from("testimonials").insert(row));
    }
    revalidatePath("/admin/content/testimonials");
    return { result: { ok: true, message: "Testimonials saved." } };
  });
}
