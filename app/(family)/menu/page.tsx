import { ViewTransition } from "react";

import { DayCard } from "@/components/menu/day-card";
import { MealCard } from "@/components/menu/meal-card";
import { DEMO_WEEK, demoDay } from "@/lib/demo/menu";

export const metadata = { title: "This week's menu" };

const TILTS = [-1.2, 1.4, -0.8];

export default async function MenuPage({ searchParams }: PageProps<"/menu">) {
  const params = await searchParams;
  const day = demoDay(typeof params.day === "string" ? params.day : undefined);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="grid grid-cols-12 items-end gap-4">
        <h1 className="col-span-12 text-5xl leading-[0.95] font-black md:col-span-8 md:text-7xl">
          This week&apos;s <span className="italic">menu</span>
        </h1>
        <p className="col-span-12 text-muted-foreground md:col-span-4 md:pb-2">
          Sample menu while the kitchen menu is being set up.
        </p>
      </div>

      <nav aria-label="Days of the week" className="-mx-4 mt-8 overflow-x-auto px-4 pb-4">
        <ul className="flex gap-3 md:grid md:grid-cols-5">
          {DEMO_WEEK.map((d, i) => (
            <li key={d.slug} className="w-24 shrink-0 md:w-auto">
              <DayCard
                day={d}
                href={`/menu?day=${d.slug}`}
                compact
                active={d.slug === day.slug}
                tilt={d.slug === day.slug ? 0 : i % 2 ? 1.5 : -1.5}
              />
            </li>
          ))}
        </ul>
      </nav>

      <ViewTransition key={day.slug} enter="page-in" exit="page-out" default="none">
        <section aria-labelledby="day-heading" className="mt-10">
          <h2 id="day-heading" className="text-4xl font-black md:text-5xl">
            {day.label}: <span className="italic">{day.headline}</span>
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            {day.meals.map((meal, i) => (
              <MealCard key={meal.id} meal={meal} tilt={TILTS[i % TILTS.length]} className={i % 2 ? "sm:mt-10" : ""} />
            ))}
          </div>
        </section>
      </ViewTransition>

      <p className="mt-12 rounded-xl border-2 border-ink bg-paper p-4 text-sm leading-relaxed shadow-ink-sm">
        <strong>Allergen note:</strong> every meal lists the allergens it contains. Our kitchen handles common
        allergens, so we can&apos;t promise any meal is allergen-free. When you order, meals that clash with your
        child&apos;s allergies are blocked.
      </p>
    </div>
  );
}
