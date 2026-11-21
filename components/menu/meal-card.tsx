import { MEAL_ART } from "@/components/art/cartoons";
import type { DemoMeal } from "@/lib/demo/menu";
import { cn } from "@/lib/utils";

/** A meal as a cartoon card. Allergens are always listed in allergy red (CLAUDE.md §6). */
export function MealCard({ meal, tilt = 0, className }: { meal: DemoMeal; tilt?: number; className?: string }) {
  const Art = MEAL_ART[meal.art];
  return (
    <article
      style={{ rotate: `${tilt}deg` }}
      className={cn("relative flex flex-col rounded-2xl border-2 border-ink bg-paper shadow-ink-lg", className)}
    >
      <div className="flex h-40 items-center justify-center rounded-t-[0.9rem] border-b-2 border-ink bg-concrete">
        <Art className="h-28 w-auto" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="text-2xl leading-tight font-bold">{meal.name}</h3>
        <p className="leading-relaxed">{meal.blurb}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {meal.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border-2 border-ink bg-orange-tint px-2.5 py-0.5 text-sm font-semibold"
            >
              {tag}
            </span>
          ))}
          {meal.contains.length > 0 ? (
            <span className="rounded-full border-2 border-allergy px-2.5 py-0.5 text-sm font-bold text-allergy">
              Contains: {meal.contains.join(", ")}
            </span>
          ) : (
            <span className="rounded-full border-2 border-ink px-2.5 py-0.5 text-sm font-semibold">
              No top-9 allergens
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
