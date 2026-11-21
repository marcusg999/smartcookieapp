import "server-only";

import { unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";

import { TAGS } from "./content";

export type PublicSettings = {
  business_name: string;
  logo_path: string | null;
  brand_colors: Record<string, string>;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: Record<string, string>;
  timezone: string;
  pilot_mode: boolean;
  ordering_enabled: boolean;
  ordering_paused_message: string;
  announcement: { enabled?: boolean; text?: string; link?: string | null };
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Brand colours as CSS variables (only valid hex values are emitted). */
export function brandCss(colors: Record<string, string>): string {
  const map: Record<string, string> = {
    primary: "--orange",
    background: "--concrete",
    surface: "--paper",
    ink: "--ink",
    accent: "--raspberry",
  };
  const rules = Object.entries(map)
    .filter(([key]) => HEX.test(colors[key] ?? ""))
    .map(([key, cssVar]) => `${cssVar}:${colors[key]}`);
  return rules.length ? `:root{${rules.join(";")}}` : "";
}

export const getPublicSettings = unstable_cache(
  async (): Promise<PublicSettings> => {
    const { data, error } = await createPublicClient().from("site_settings_public").select("*").single();
    if (error || !data) throw new Error("settings fetch failed");
    return data as PublicSettings;
  },
  ["site-settings-public"],
  { tags: [TAGS.settings], revalidate: 3600 },
);
