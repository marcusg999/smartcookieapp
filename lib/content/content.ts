import "server-only";

import { unstable_cache } from "next/cache";
import { draftMode } from "next/headers";
import { cache } from "react";

import { getUser } from "@/lib/auth/guards";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

import type { RichNode } from "@/lib/validation/rich-text";

import { CONTENT_GROUPS } from "./registry";

/** Cache tags. Admin actions call updateTag(tag) after a successful write. */
export const TAGS = { content: "content", settings: "settings", menu: "menu", pages: "pages", faqs: "faqs" } as const;

export type ContentMap = Record<string, unknown>;
export type Cta = { label: string; href: string };

const fetchPublished = unstable_cache(
  async (): Promise<ContentMap> => {
    const { data, error } = await createPublicClient().from("content_blocks_public").select("key, value");
    if (error) throw new Error(`content fetch failed: ${error.code}`);
    return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
  },
  ["content-blocks-public"],
  { tags: [TAGS.content], revalidate: 3600 },
);

/** True when the owner turned on preview (draft mode) and is still a signed-in owner at AAL2. */
export const isOwnerPreview = cache(async (): Promise<boolean> => {
  const { isEnabled } = await draftMode();
  if (!isEnabled) return false;
  const user = await getUser();
  return Boolean(user && user.aal === "aal2" && user.roles.includes("owner"));
});

/**
 * All site copy. Published values for everyone; drafts layered on top for
 * the owner in preview mode (never cached, read with the owner's own session
 * so RLS still applies).
 */
export const getContent = cache(async (): Promise<Content> => {
  if (!(await isOwnerPreview())) {
    try {
      return new Content(await fetchPublished(), false);
    } catch (error) {
      // Database unreachable: serve the launch copy rather than an error page.
      console.error("content fetch failed; using registry defaults", { error: (error as Error).message });
      return new Content(
        Object.fromEntries(CONTENT_GROUPS.flatMap((g) => g.items).map((d) => [d.key, d.default])),
        false,
      );
    }
  }
  // Preview never touches the shared cache (a draft-mode render that filled it
  // could race a publish and pin stale copy for visitors).
  const supabase = await createClient();
  const { data } = await supabase.from("content_blocks").select("key, draft_value, published_value");
  const merged: ContentMap = {};
  for (const row of data ?? []) merged[row.key] = row.draft_value ?? row.published_value;
  return new Content(merged, true);
});

export class Content {
  constructor(
    private readonly values: ContentMap,
    readonly preview: boolean,
  ) {}

  /** Plain text. Missing keys render as an empty string (and are reported in dev). */
  text(key: string, vars?: Record<string, string>): string {
    const value = this.values[key];
    if (typeof value !== "string") {
      if (process.env.NODE_ENV !== "production") console.warn(`[content] missing text for "${key}"`);
      return "";
    }
    return vars ? value.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "") : value;
  }

  cta(key: string): Cta {
    const value = this.values[key] as Partial<Cta> | undefined;
    return {
      label: typeof value?.label === "string" ? value.label : "",
      // Re-checked at render: only site-relative, http(s) or mailto links.
      href: typeof value?.href === "string" && /^(https?:\/\/|mailto:|\/(?!\/))/.test(value.href) ? value.href : "/",
    };
  }

  rich(key: string): RichNode | null {
    const value = this.values[key] as RichNode | undefined;
    return value && typeof value === "object" && value.type === "doc" ? value : null;
  }

  json<T>(key: string, fallback: T): T {
    const value = this.values[key];
    return (value ?? fallback) as T;
  }
}
