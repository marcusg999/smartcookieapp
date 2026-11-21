/**
 * Every editable piece of customer-facing copy, grouped the way the owner
 * thinks about the site (Phase 4 §6). The VALUES live in `content_blocks`
 * (seeded in supabase/seed.sql, edited in /admin/content); this registry only
 * describes each key so the admin can group and label them.
 */
export type ContentType = "text" | "rich_text" | "image" | "json" | "cta";

export type ContentDef = { key: string; label: string; type: ContentType; help?: string };
export type ContentGroup = { id: string; label: string; items: ContentDef[] };

export const CONTENT_GROUPS: ContentGroup[] = [
  {
    id: "home",
    label: "Home page",
    items: [
      { key: "home.hero.eyebrow", label: "Small label above the headline", type: "text" },
      { key: "home.hero.title", label: "Headline (first line)", type: "text" },
      { key: "home.hero.title_highlight", label: "Headline (highlighted words)", type: "text" },
      { key: "home.hero.subtitle", label: "Text under the headline", type: "text" },
      { key: "home.hero.cta", label: "Main button", type: "cta" },
      { key: "home.hero.cta_secondary", label: "Second button", type: "cta" },
      { key: "home.hero.caption", label: "Caption under the lunch tray", type: "text" },
      { key: "home.hero.caption_done", label: "Caption once the tray is packed", type: "text" },
      { key: "home.hero.scroll_hint", label: '"Scroll" hint', type: "text" },
      { key: "home.week.title", label: '"This week" heading', type: "text" },
      { key: "home.week.subtitle", label: '"This week" text', type: "text" },
      { key: "home.allergy.title", label: "Allergy box heading", type: "text" },
      { key: "home.allergy.body", label: "Allergy box text", type: "text" },
      { key: "home.schools.title", label: "Schools heading", type: "text" },
      { key: "home.schools.title_highlight", label: "Schools heading (highlighted words)", type: "text" },
      { key: "home.schools.body", label: "Schools text", type: "text" },
      { key: "home.schools.cta", label: "Schools button", type: "cta" },
    ],
  },
  {
    id: "how_it_works",
    label: "How it works",
    items: [
      { key: "how_it_works.title", label: "Heading", type: "text" },
      {
        key: "how_it_works.steps",
        label: "The three steps",
        type: "json",
        help: "Each step has a title, text and a speech bubble.",
      },
    ],
  },
  {
    id: "menu",
    label: "Menu page",
    items: [
      { key: "menu.title", label: "Page heading", type: "text" },
      { key: "menu.subtitle", label: "Text under the heading", type: "text" },
      { key: "menu.empty", label: "When no menu is published", type: "text" },
      { key: "menu.allergen_disclaimer", label: "Allergen note", type: "rich_text" },
      { key: "menu.contains_label", label: '"Contains" label', type: "text" },
      { key: "menu.may_contain_label", label: '"May contain" label', type: "text" },
      { key: "menu.no_allergens_label", label: '"No top-9 allergens" label', type: "text" },
      { key: "menu.cutoff_label", label: '"Order by" label', type: "text" },
    ],
  },
  {
    id: "checkout",
    label: "Checkout",
    items: [{ key: "checkout.allergy_disclaimer", label: "Allergy disclaimer at checkout", type: "rich_text" }],
  },
  {
    id: "account",
    label: "Account pages",
    items: [
      { key: "account.title", label: "Account page heading", type: "text" },
      { key: "account.greeting", label: "Greeting (use {name})", type: "text" },
      { key: "account.passkey_offer.title", label: "Passkey suggestion heading", type: "text" },
      { key: "account.passkey_offer.body", label: "Passkey suggestion text", type: "text" },
      { key: "account.security.title", label: "Security card heading", type: "text" },
      { key: "account.security.body", label: "Security card text", type: "text" },
      { key: "account.privacy.title", label: "Privacy card heading", type: "text" },
      { key: "account.privacy.body", label: "Privacy card text", type: "text" },
      { key: "account.coming_soon", label: '"Coming soon" text for pages not built yet', type: "text" },
    ],
  },
  {
    id: "school",
    label: "School landing",
    items: [{ key: "school.pending_banner", label: "Banner while a school awaits approval", type: "text" }],
  },
  {
    id: "footer",
    label: "Footer",
    items: [
      { key: "footer.tagline", label: "Tagline", type: "text" },
      { key: "footer.allergen_note", label: "Allergen note", type: "text" },
    ],
  },
  {
    id: "navigation",
    label: "Navigation & buttons",
    items: [
      { key: "nav.menu", label: '"Menu" link', type: "text" },
      { key: "nav.how_it_works", label: '"How it works" link', type: "text" },
      { key: "nav.schools", label: '"For schools" link', type: "text" },
      { key: "nav.sign_in", label: '"Sign in" button', type: "text" },
      { key: "nav.get_started", label: '"Get started" button', type: "text" },
      { key: "nav.sign_out", label: '"Sign out" button', type: "text" },
      { key: "nav.tab_menu", label: "Phone tab: Menu", type: "text" },
      { key: "nav.tab_orders", label: "Phone tab: Orders", type: "text" },
      { key: "nav.tab_cart", label: "Phone tab: Cart", type: "text" },
      { key: "nav.tab_favorites", label: "Phone tab: Favorites", type: "text" },
      { key: "nav.tab_account", label: "Phone tab: Account", type: "text" },
    ],
  },
  {
    id: "banners",
    label: "Banners",
    items: [{ key: "banner.preview_mode", label: "Preview mode banner (owner only)", type: "text" }],
  },
];

export const CONTENT_KEYS: string[] = CONTENT_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export function contentDef(key: string): ContentDef | undefined {
  for (const group of CONTENT_GROUPS) {
    const found = group.items.find((i) => i.key === key);
    if (found) return found;
  }
  return undefined;
}
