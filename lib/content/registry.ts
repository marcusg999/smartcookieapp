/**
 * Every editable piece of customer-facing copy, grouped the way the owner
 * thinks about the site (Phase 4 §6). The VALUES live in `content_blocks`
 * (seeded in supabase/seed.sql, edited in /admin/content); this registry only
 * describes each key so the admin can group and label them.
 */
export type ContentType = "text" | "rich_text" | "image" | "json" | "cta";

/** `default` is the launch copy: seeded into content_blocks (scripts/gen-content-seed.mjs). */
export type ContentDef = { key: string; label: string; type: ContentType; help?: string; default: unknown };
export type ContentGroup = { id: string; label: string; items: ContentDef[] };

const rich = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

export const CONTENT_GROUPS: ContentGroup[] = [
  {
    id: "home",
    label: "Home page",
    items: [
      {
        key: "home.hero.eyebrow",
        label: "Small label above the headline",
        type: "text",
        default: "Private kids' chef · families & schools",
      },
      { key: "home.hero.title", label: "Headline (first line)", type: "text", default: "Lunch," },
      { key: "home.hero.title_highlight", label: "Headline (highlighted words)", type: "text", default: "handled." },
      {
        key: "home.hero.subtitle",
        label: "Text under the headline",
        type: "text",
        default:
          "Healthy, home-cooked meals your kids will actually eat. Order the whole week in minutes. No more PDF forms.",
      },
      {
        key: "home.hero.cta",
        label: "Main button",
        type: "cta",
        default: { label: "See this week's menu", href: "/menu" },
      },
      {
        key: "home.hero.cta_secondary",
        label: "Second button",
        type: "cta",
        default: { label: "Create a family account", href: "/sign-up" },
      },
      {
        key: "home.hero.caption",
        label: "Caption under the lunch tray",
        type: "text",
        default: "Mac & cheese, broccoli, apple, carrots",
      },
      {
        key: "home.hero.caption_done",
        label: "Caption once the tray is packed",
        type: "text",
        default: "Lunch packed. Allergies checked for every child.",
      },
      { key: "home.hero.stamp", label: 'Stamp on the packed tray ("PACKED!")', type: "text", default: "PACKED!" },
      { key: "home.hero.scroll_hint", label: '"Scroll" hint', type: "text", default: "Scroll to pack lunch" },
      { key: "home.week.title", label: '"This week" heading', type: "text", default: "This week, at a glance" },
      {
        key: "home.week.subtitle",
        label: '"This week" text',
        type: "text",
        default: "A fresh menu every week. Tap a meal to see what's cooking.",
      },
      {
        key: "home.allergy.title",
        label: "Allergy box heading",
        type: "text",
        default: "Allergies are blocked, not just noted.",
      },
      {
        key: "home.allergy.body",
        label: "Allergy box text",
        type: "text",
        default:
          "If a meal contains something on your child's allergy list, you can't add it by mistake. At checkout we ask one quick question: \u201cAre these still correct for each child?\u201d",
      },
      { key: "home.schools.title", label: "Schools heading", type: "text", default: "Feeding a" },
      {
        key: "home.schools.title_highlight",
        label: "Schools heading (highlighted words)",
        type: "text",
        default: "whole class?",
      },
      {
        key: "home.schools.body",
        label: "Schools text",
        type: "text",
        default:
          "Standing orders sized to each classroom's headcount, drop-off at school, and one simple invoice each month.",
      },
      {
        key: "home.schools.cta",
        label: "Schools button",
        type: "cta",
        default: { label: "Set up your school", href: "/sign-up" },
      },
    ],
  },
  {
    id: "how_it_works",
    label: "How it works",
    items: [
      { key: "how_it_works.title", label: "Heading", type: "text", default: "How it works" },
      {
        key: "how_it_works.steps",
        label: "The three steps",
        type: "json",
        help: "Each step has a title, text and a speech bubble.",
        default: [
          {
            title: "Tell us about your kids",
            body: "First names, classroom and allergies. Once. We remember them every week.",
            bubble: "Sam can't have sesame!",
          },
          {
            title: "Pick meals in a few taps",
            body: "Choose from this week's menu for each child, or reorder last week's favourites with one tap.",
            bubble: "Same as last week, please.",
          },
          {
            title: "We cook. You relax.",
            body: "Fresh, home-cooked and labelled for each child. Delivered to your door or straight to school.",
            bubble: "Lunch is here!",
          },
        ],
      },
    ],
  },
  {
    id: "menu",
    label: "Menu page",
    items: [
      { key: "menu.title", label: "Page heading", type: "text", default: "This week's menu" },
      {
        key: "menu.subtitle",
        label: "Text under the heading",
        type: "text",
        default: "Fresh, home-cooked meals for the week ahead.",
      },
      {
        key: "menu.empty",
        label: "When no menu is published",
        type: "text",
        default: "The next menu is being cooked up. Check back soon!",
      },
      {
        key: "menu.allergen_disclaimer",
        label: "Allergen note",
        type: "rich_text",
        default: rich(
          "Every meal lists the allergens it contains. Our kitchen handles common allergens, so we can't promise any meal is allergen-free. When you order, meals that clash with your child's allergies are blocked.",
        ),
      },
      { key: "menu.contains_label", label: '"Contains" label', type: "text", default: "Contains" },
      { key: "menu.may_contain_label", label: '"May contain" label', type: "text", default: "May contain" },
      {
        key: "menu.no_allergens_label",
        label: '"No top-9 allergens" label',
        type: "text",
        default: "No top-9 allergens",
      },
      { key: "menu.cutoff_label", label: '"Order by" label', type: "text", default: "Order by {date}" },
    ],
  },
  {
    id: "checkout",
    label: "Checkout",
    items: [
      {
        key: "checkout.allergy_disclaimer",
        label: "Allergy disclaimer at checkout",
        type: "rich_text",
        default: rich(
          "Please check each child's allergies below. Meals that clash with a listed allergy can't be ordered. Our kitchen handles common allergens and shared equipment.",
        ),
      },
    ],
  },
  {
    id: "account",
    label: "Account pages",
    items: [
      { key: "account.title", label: "Account page heading", type: "text", default: "Your account" },
      { key: "account.greeting", label: "Greeting (use {name})", type: "text", default: "Hi, {name}" },
      {
        key: "account.passkey_offer.title",
        label: "Passkey suggestion heading",
        type: "text",
        default: "Sign in faster with a passkey",
      },
      {
        key: "account.passkey_offer.body",
        label: "Passkey suggestion text",
        type: "text",
        default: "Use Face ID, Touch ID or your device PIN instead of a password.",
      },
      { key: "account.passkey_offer.cta", label: "Passkey suggestion link", type: "text", default: "Add a passkey" },
      { key: "account.security.title", label: "Security card heading", type: "text", default: "Security" },
      {
        key: "account.security.body",
        label: "Security card text",
        type: "text",
        default: "Sign-in methods, passkeys, password, two-factor, devices.",
      },
      { key: "account.privacy.title", label: "Privacy card heading", type: "text", default: "Privacy" },
      {
        key: "account.privacy.body",
        label: "Privacy card text",
        type: "text",
        default: "Download your data or delete your account.",
      },
      {
        key: "account.coming_soon",
        label: '"Coming soon" text for pages not built yet',
        type: "text",
        default: "Coming soon",
      },
    ],
  },
  {
    id: "school",
    label: "School landing",
    items: [
      {
        key: "school.pending_banner",
        label: "Banner while a school awaits approval",
        type: "text",
        default: "Thanks for applying! We're reviewing your school and will email you once it's approved.",
      },
    ],
  },
  {
    id: "footer",
    label: "Footer",
    items: [
      {
        key: "footer.tagline",
        label: "Tagline",
        type: "text",
        default: "Healthy, home-cooked meals for kids. Made fresh every week.",
      },
      {
        key: "footer.allergen_note",
        label: "Allergen note",
        type: "text",
        default:
          "Allergen information is listed on every meal. We take allergies seriously, but our kitchen handles common allergens, so we never promise \u201callergen-free\u201d.",
      },
    ],
  },
  {
    id: "navigation",
    label: "Navigation & buttons",
    items: [
      { key: "nav.menu", label: '"Menu" link', type: "text", default: "This week's menu" },
      { key: "nav.how_it_works", label: '"How it works" link', type: "text", default: "How it works" },
      { key: "nav.schools", label: '"For schools" link', type: "text", default: "For schools" },
      { key: "nav.sign_in", label: '"Sign in" button', type: "text", default: "Sign in" },
      { key: "nav.get_started", label: '"Get started" button', type: "text", default: "Get started" },
      { key: "nav.sign_out", label: '"Sign out" button', type: "text", default: "Sign out" },
      { key: "nav.tab_menu", label: "Phone tab: Menu", type: "text", default: "Menu" },
      { key: "nav.tab_orders", label: "Phone tab: Orders", type: "text", default: "Orders" },
      { key: "nav.tab_cart", label: "Phone tab: Cart", type: "text", default: "Cart" },
      { key: "nav.tab_favorites", label: "Phone tab: Favorites", type: "text", default: "Favorites" },
      { key: "nav.tab_account", label: "Phone tab: Account", type: "text", default: "Account" },
    ],
  },
  {
    id: "banners",
    label: "Banners",
    items: [
      {
        key: "banner.preview_mode",
        label: "Preview mode banner (owner only)",
        type: "text",
        default: "Preview mode: you're seeing unpublished changes.",
      },
    ],
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
