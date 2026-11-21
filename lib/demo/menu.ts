import type { MealArtKey } from "@/components/art/cartoons";

/**
 * DEMO DATA, shown until the menu phase replaces it with the owner-editable
 * menu from the database (CLAUDE.md §1: every customer-facing menu item will
 * live in the DB and be edited in /admin). Allergens follow the top-9 list.
 */
export type DemoMeal = {
  id: string;
  name: string;
  blurb: string;
  art: MealArtKey;
  contains: string[];
  tags: string[];
};

export type DemoDay = { slug: string; label: string; short: string; headline: string; meals: DemoMeal[] };

export const DEMO_WEEK: DemoDay[] = [
  {
    slug: "mon",
    label: "Monday",
    short: "Mon",
    headline: "Mac & cheese day",
    meals: [
      {
        id: "mon-1",
        name: "Baked mac & cheese",
        blurb: "Elbow pasta, sharp cheddar, hidden butternut squash.",
        art: "pasta",
        contains: ["milk", "wheat"],
        tags: ["vegetarian"],
      },
      {
        id: "mon-2",
        name: "Garden broccoli bites",
        blurb: "Roasted florets, lemon, olive oil.",
        art: "broccoli",
        contains: [],
        tags: ["vegan"],
      },
    ],
  },
  {
    slug: "tue",
    label: "Tuesday",
    short: "Tue",
    headline: "Wrap it up",
    meals: [
      {
        id: "tue-1",
        name: "Turkey & avocado wrap",
        blurb: "Whole-wheat tortilla, avocado, crunchy lettuce.",
        art: "wrap",
        contains: ["wheat"],
        tags: [],
      },
      {
        id: "tue-2",
        name: "Carrot sticks & hummus",
        blurb: "Sweet carrots with homemade hummus.",
        art: "carrots",
        contains: ["sesame"],
        tags: ["vegan"],
      },
    ],
  },
  {
    slug: "wed",
    label: "Wednesday",
    short: "Wed",
    headline: "Orchard Wednesday",
    meals: [
      {
        id: "wed-1",
        name: "Apple cinnamon oats",
        blurb: "Overnight oats, crisp apple, a little cinnamon.",
        art: "apple",
        contains: ["milk"],
        tags: ["vegetarian"],
      },
      {
        id: "wed-2",
        name: "Veggie pasta salad",
        blurb: "Spiral pasta, peas, cherry tomatoes.",
        art: "pasta",
        contains: ["wheat"],
        tags: ["vegan"],
      },
    ],
  },
  {
    slug: "thu",
    label: "Thursday",
    short: "Thu",
    headline: "Green machine",
    meals: [
      {
        id: "thu-1",
        name: "Broccoli cheddar bake",
        blurb: "Golden top, soft middle, lots of green.",
        art: "broccoli",
        contains: ["milk", "eggs"],
        tags: ["vegetarian"],
      },
      {
        id: "thu-2",
        name: "Rainbow carrot slaw",
        blurb: "Shredded carrots, apple, honey-lime dressing.",
        art: "carrots",
        contains: [],
        tags: ["vegetarian"],
      },
    ],
  },
  {
    slug: "fri",
    label: "Friday",
    short: "Fri",
    headline: "Cookie Friday",
    meals: [
      {
        id: "fri-1",
        name: "Chicken veggie wrap",
        blurb: "Grilled chicken, peppers, mild yogurt sauce.",
        art: "wrap",
        contains: ["wheat", "milk"],
        tags: [],
      },
      {
        id: "fri-2",
        name: "Oat & apple cookie",
        blurb: "Our namesake. Sweetened with fruit.",
        art: "cookie",
        contains: ["wheat", "eggs"],
        tags: ["vegetarian"],
      },
    ],
  },
];

export function demoDay(slug: string | undefined): DemoDay {
  return DEMO_WEEK.find((d) => d.slug === slug) ?? DEMO_WEEK[0]!;
}
