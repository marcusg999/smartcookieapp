import { MealImage } from "@/components/menu/meal-image";
import { formatCents } from "@/lib/money";
import type { PublicMeal } from "@/lib/menu/queries";
import { cn } from "@/lib/utils";

export type MealLabels = { contains: string; mayContain: string; noAllergens: string };

/** A meal card. Allergens are always listed in allergy red (CLAUDE.md §6). Labels come from the CMS. */
export function MealCard({
  meal,
  labels,
  tilt = 0,
  className,
}: {
  meal: PublicMeal;
  labels: MealLabels;
  tilt?: number;
  className?: string;
}) {
  return (
    <article
      style={{ rotate: `${tilt}deg` }}
      className={cn("relative flex flex-col rounded-2xl border-2 border-ink bg-paper shadow-ink-lg", className)}
    >
      <MealImage
        path={meal.image?.path}
        alt={meal.image?.alt ?? meal.name}
        className="h-44 rounded-t-[0.9rem] border-b-2 border-ink"
      />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-2xl leading-tight font-bold">{meal.name}</h3>
          <span className="shrink-0 rounded-md border-2 border-ink bg-orange px-2 py-0.5 font-bold">
            {formatCents(meal.price_cents)}
          </span>
        </div>
        {meal.short_description ? <p className="leading-relaxed">{meal.short_description}</p> : null}
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {meal.badges.map((tag) => (
            <span
              key={tag}
              className="rounded-full border-2 border-ink bg-orange-tint px-2.5 py-0.5 text-sm font-semibold"
            >
              {tag}
            </span>
          ))}
          {meal.contains.length > 0 ? (
            <span className="rounded-full border-2 border-allergy px-2.5 py-0.5 text-sm font-bold text-allergy">
              {labels.contains}: {meal.contains.join(", ")}
            </span>
          ) : (
            <span className="rounded-full border-2 border-ink px-2.5 py-0.5 text-sm font-semibold">
              {labels.noAllergens}
            </span>
          )}
          {meal.may_contain.length > 0 ? (
            <span className="rounded-full border-2 border-dashed border-allergy px-2.5 py-0.5 text-sm font-semibold text-allergy">
              {labels.mayContain}: {meal.may_contain.join(", ")}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
