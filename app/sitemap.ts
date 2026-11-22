import type { MetadataRoute } from "next";

import { getPublishedPageSlugs } from "@/lib/content/public-data";
import { publicEnv } from "@/lib/env.public";

/** Marketing pages plus every published CMS page (About, policies…). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicEnv.NEXT_PUBLIC_SITE_URL;
  const pages = await getPublishedPageSlugs().catch(() => []);
  const now = new Date();
  return [
    { url: new URL("/", base).toString(), changeFrequency: "weekly", priority: 1, lastModified: now },
    { url: new URL("/menu", base).toString(), changeFrequency: "weekly", priority: 0.9, lastModified: now },
    { url: new URL("/plans", base).toString(), changeFrequency: "monthly", priority: 0.8 },
    { url: new URL("/schools", base).toString(), changeFrequency: "monthly", priority: 0.7 },
    { url: new URL("/faq", base).toString(), changeFrequency: "monthly", priority: 0.6 },
    ...pages.map((p) => ({
      url: new URL(`/${p.slug}`, base).toString(),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
