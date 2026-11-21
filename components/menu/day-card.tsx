import Link from "next/link";
import { ViewTransition } from "react";

import { MEAL_ART } from "@/components/art/cartoons";
import type { DemoDay } from "@/lib/demo/menu";
import { cn } from "@/lib/utils";

/**
 * A day of the week as a tilted cartoon card. The same `day-<slug>` view
 * transition name is used on the home page strip and on /menu, so the card
 * morphs from one page to the other.
 */
export function DayCard({
  day,
  href,
  tilt = 0,
  active = false,
  compact = false,
  className,
}: {
  day: DemoDay;
  href: string;
  tilt?: number;
  active?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const Art = MEAL_ART[day.meals[0]!.art];
  return (
    <ViewTransition name={`day-${day.slug}`} share="morph" default="none">
      <Link
        href={href}
        scroll={false}
        aria-current={active ? "page" : undefined}
        aria-label={`${day.label}: ${day.headline}`}
        style={{ rotate: `${tilt}deg` }}
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-2xl border-2 border-ink bg-paper shadow-ink transition-[translate,box-shadow,rotate] duration-200 hover:-translate-y-1 hover:rotate-0 hover:shadow-ink-lg focus-visible:rotate-0",
          active && "bg-orange",
          className,
        )}
      >
        <div className={cn("flex items-baseline justify-between px-3 pt-2", compact ? "pb-0" : "pb-1")}>
          <span className="font-display text-2xl leading-none font-black italic">{day.short}</span>
          {!compact ? (
            <span className="text-xs font-bold tracking-wide uppercase">{day.meals.length} meals</span>
          ) : null}
        </div>
        <div className={cn("flex flex-1 items-center justify-center px-3", compact ? "py-1" : "py-3")}>
          <Art
            className={cn(
              "h-auto transition-transform duration-300 group-hover:scale-110",
              compact ? "w-14" : "w-[72%] max-w-36",
            )}
          />
        </div>
        {!compact ? (
          <p className="border-t-2 border-ink bg-paper px-3 py-2 text-sm leading-tight font-semibold">{day.headline}</p>
        ) : null}
      </Link>
    </ViewTransition>
  );
}
