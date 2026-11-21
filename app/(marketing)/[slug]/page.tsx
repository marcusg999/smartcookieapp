import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";

import { RichText } from "@/components/rich-text";
import { TAGS } from "@/lib/content/content";
import { createPublicClient } from "@/lib/supabase/public";
import type { RichNode } from "@/lib/validation/rich-text";

type PublicPage = {
  slug: string;
  title: string;
  seo_title: string | null;
  seo_description: string | null;
  og_image: string | null;
  body: RichNode | null;
};

const getPage = unstable_cache(
  async (slug: string): Promise<PublicPage | null> => {
    const { data } = await createPublicClient()
      .from("pages_public")
      .select("slug, title, seo_title, seo_description, og_image, body")
      .eq("slug", slug)
      .maybeSingle();
    return (data as PublicPage | null) ?? null;
  },
  ["public-page"],
  { tags: [TAGS.pages], revalidate: 3600 },
);

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = /^[a-z0-9-]{1,80}$/.test(slug) ? await getPage(slug) : null;
  if (!page) return {};
  return { title: page.seo_title ?? page.title, description: page.seo_description ?? undefined };
}

/** Owner-managed pages (About, policies…), published from /admin/content/pages. */
export default async function CmsPage({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const page = await getPage(slug);
  if (!page) notFound();
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-14">
      <h1 className="text-5xl leading-tight font-black">{page.title}</h1>
      <RichText doc={page.body} className="mt-8 text-lg leading-relaxed" />
    </article>
  );
}
