import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { KitchenWeek } from "@/lib/kitchen/data";
import type { ChildAllergy } from "@/lib/kitchen/logic";
import { weekIsOpen } from "@/lib/kitchen/week";
import { formatDay, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";

import { PrintButton } from "./print-button";

/**
 * Kitchen screens: large type and high contrast for an iPad on a counter,
 * and clean print output (navigation and buttons are hidden when printing).
 */
export function KitchenHeader({
  title,
  description,
  weeks,
  week,
  path,
  actions,
  extraQuery = "",
}: {
  title: string;
  description?: string;
  weeks: KitchenWeek[];
  week: KitchenWeek | undefined;
  path: string;
  actions?: ReactNode;
  extraQuery?: string;
}) {
  const open = week ? weekIsOpen(week) : false;
  return (
    <header className="mb-6 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
          {week ? (
            <p className="mt-1 text-lg">
              Week of {formatDay(week.week_start, { month: "long", day: "numeric" })} ·{" "}
              {open ? (
                <span className="font-bold">Open until {formatInZone(week.cutoff, "America/Los_Angeles")}</span>
              ) : (
                <span className="font-bold">
                  {week.status === "fulfilled" ? "Fulfilled" : "Closed"} (cutoff{" "}
                  {formatInZone(week.cutoff, "America/Los_Angeles")})
                </span>
              )}
            </p>
          ) : null}
          {description ? <p className="mt-1 text-muted-foreground print:hidden">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {actions}
          <PrintButton />
        </div>
      </div>
      <nav aria-label="Weeks" className="flex gap-2 overflow-x-auto pb-1 print:hidden">
        {weeks.map((w) => (
          <Link
            key={w.id}
            href={`${path}?week=${w.id}${extraQuery}`}
            aria-current={w.id === week?.id ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full border-2 border-ink px-4 py-1.5 text-base font-bold",
              w.id === week?.id ? "bg-orange shadow-ink-sm" : "bg-paper",
            )}
          >
            {formatDay(w.week_start, { month: "short", day: "numeric" })}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Allergy flags are always red; severe ones are filled with an icon (CLAUDE.md §6). */
export function AllergyFlags({ allergens, className }: { allergens: ChildAllergy[]; className?: string }) {
  if (allergens.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {allergens.map((a) => (
        <li
          key={a.name}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border-2 border-allergy px-2 py-0.5 text-sm font-bold",
            a.severity === "severe" ? "bg-allergy text-allergy-foreground" : "text-allergy",
          )}
        >
          {a.severity === "severe" ? <ShieldAlert aria-hidden="true" className="size-4" /> : null}
          {a.name}
          {a.severity === "severe" ? " (severe)" : a.severity === "intolerance" ? " (intolerance)" : ""}
        </li>
      ))}
    </ul>
  );
}

export function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "alert";
}) {
  return (
    <div className={cn("rounded-2xl border-2 border-ink bg-paper p-4", tone === "alert" && "border-allergy")}>
      <p className="text-sm font-bold tracking-wide uppercase">{label}</p>
      <p className={cn("text-4xl font-black", tone === "alert" && "text-allergy")}>{value}</p>
      {sub ? <div className="mt-1 text-sm text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export const dayLabel = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDay(d, { weekday: "long", month: "short", day: "numeric" }) : "No date";
