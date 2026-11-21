"use client";

import { ShieldAlert } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { fmt, type Copy } from "@/lib/content/fmt";
import { timeLeft } from "@/lib/ordering/logic";
import { cn } from "@/lib/utils";

export { fmt, type Copy };


/** A child's allergies, always in allergy red (CLAUDE.md §6). */
export function AllergyChips({
  allergies,
  emptyLabel,
  className,
  size = "sm",
}: {
  allergies: { allergen: string; severity: string }[];
  emptyLabel?: string;
  className?: string;
  size?: "xs" | "sm";
}) {
  if (allergies.length === 0) {
    return emptyLabel ? <span className={cn("text-sm text-muted-foreground", className)}>{emptyLabel}</span> : null;
  }
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {allergies.map((a) => (
        <li
          key={a.allergen}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border-2 border-allergy font-bold text-allergy",
            size === "xs" ? "px-1.5 py-0 text-[0.7rem]" : "px-2 py-0.5 text-xs",
            a.severity === "severe" && "bg-allergy text-allergy-foreground",
          )}
        >
          <ShieldAlert aria-hidden="true" className="size-3" />
          {a.allergen}
        </li>
      ))}
    </ul>
  );
}

// A 30-second clock shared by every countdown (null on the server, so no hydration mismatch).
function subscribeClock(onChange: () => void) {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
}
const clockSnapshot = () => Math.floor(Date.now() / 30_000);

/** Live "3d 4h left" countdown to a cutoff. Renders the static label on the server. */
export function Countdown({ cutoff, template, closedLabel }: { cutoff: string; template: string; closedLabel: string }) {
  const tick = useSyncExternalStore(subscribeClock, clockSnapshot, () => null);
  if (tick === null) return null;
  const left = timeLeft(cutoff, new Date(tick * 30_000));
  if (left.closed) return <span>{closedLabel}</span>;
  const parts = left.days > 0 ? `${left.days}d ${left.hours}h` : left.hours > 0 ? `${left.hours}h ${left.minutes}m` : `${left.minutes}m`;
  return (
    <span className={cn(left.totalMs < 6 * 3_600_000 && "animate-pulse")} suppressHydrationWarning>
      {fmt(template, { time: parts })}
    </span>
  );
}

/** Big tappable toggle chip (allergies, preferences). */
export function Chip({
  pressed,
  onPressedChange,
  children,
  tone = "default",
  className,
}: {
  pressed: boolean;
  onPressedChange: (v: boolean) => void;
  children: ReactNode;
  tone?: "default" | "allergy";
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 py-2 text-sm font-bold transition-[transform,background-color,box-shadow] duration-150 select-none active:scale-95",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink",
        tone === "allergy"
          ? pressed
            ? "border-allergy bg-allergy text-allergy-foreground shadow-[2px_2px_0_0_var(--ink)]"
            : "border-allergy/60 bg-paper text-allergy hover:border-allergy"
          : pressed
            ? "border-ink bg-orange shadow-ink-sm"
            : "border-ink/40 bg-paper hover:border-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A section card in the family area's visual language. */
export function Panel({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "li" }) {
  return <As className={cn("rounded-2xl border-2 border-ink bg-paper p-5 shadow-ink", className)}>{children}</As>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-4xl leading-[0.95] font-black md:text-5xl">{children}</h1>
      {sub ? <p className="mt-2 max-w-2xl text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
