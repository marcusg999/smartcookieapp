import "server-only";

import { unstable_cache } from "next/cache";

import { PLAN_COLUMNS, type Plan } from "@/lib/family/queries";
import { createPublicClient } from "@/lib/supabase/public";
import type { RichNode } from "@/lib/validation/rich-text";

import { TAGS } from "./content";

/** Public, cached reads for the marketing pages (anon key; RLS exposes published rows only). */

export const getPublicPlans = unstable_cache(
  async (): Promise<Plan[]> => {
    const { data } = await createPublicClient().from("plans").select(PLAN_COLUMNS).eq("audience", "family").order("sort_order");
    return (data ?? []) as Plan[];
  },
  ["public-plans"],
  { tags: [TAGS.content, "plans"], revalidate: 3600 },
);

export type PublicFaq = { id: string; question: string; answer_rich: RichNode | null; category: string | null };

export const getPublishedFaqs = unstable_cache(
  async (): Promise<PublicFaq[]> => {
    const { data } = await createPublicClient()
      .from("faqs")
      .select("id, question, answer_rich, category")
      .eq("is_published", true)
      .order("sort_order");
    return (data ?? []) as PublicFaq[];
  },
  ["public-faqs"],
  { tags: [TAGS.faqs], revalidate: 3600 },
);

export const getPublishedTestimonials = unstable_cache(
  async (): Promise<{ id: string; quote: string; attribution: string | null }[]> => {
    const { data } = await createPublicClient()
      .from("testimonials")
      .select("id, quote, attribution")
      .eq("is_published", true)
      .order("sort_order");
    return (data ?? []) as { id: string; quote: string; attribution: string | null }[];
  },
  ["public-testimonials"],
  { tags: [TAGS.content], revalidate: 3600 },
);

export const getPublishedPageSlugs = unstable_cache(
  async (): Promise<{ slug: string; title: string }[]> => {
    const { data } = await createPublicClient().from("pages_public").select("slug, title").order("title");
    return (data ?? []) as { slug: string; title: string }[];
  },
  ["public-page-slugs"],
  { tags: [TAGS.pages], revalidate: 3600 },
);
