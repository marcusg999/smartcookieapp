"use client";

import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { fmt, type Copy } from "@/lib/content/fmt";
import { cn } from "@/lib/utils";

export { Countdown, PageTitle, Panel } from "@/components/family/kit";
export { fmt, type Copy };

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Allergen names as red chips (CLAUDE.md §6: allergy flags are always red). */
export function AllergenChips({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)}>
      {names.map((n) => (
        <li
          key={n}
          className="inline-flex items-center gap-1 rounded-full border-2 border-allergy px-2 py-0.5 text-xs font-bold text-allergy"
        >
          <ShieldAlert aria-hidden="true" className="size-3" />
          {n}
        </li>
      ))}
    </ul>
  );
}

type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

/**
 * Run a Server Action with a pending state, a toast and a refresh. Returns
 * the result so forms can show field errors.
 */
export function useRun(copy: Copy) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, success?: string, after?: (r: Result) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? success ?? copy.saved);
        router.refresh();
      } else {
        toast.error(r.message ?? copy.error);
      }
      after?.(r);
    });
  return { pending, run };
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const selectClass =
  "h-11 w-full rounded-md border-2 border-ink bg-paper px-3 text-base focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink";
export const textareaClass =
  "min-h-20 w-full rounded-md border-2 border-ink bg-paper px-3 py-2 text-base focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function StatusTag({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border-2 px-2 py-0.5 text-xs font-bold",
        tone === "ok" && "border-ink bg-paper",
        tone === "warn" && "border-ink bg-orange-tint",
        tone === "bad" && "border-allergy bg-allergy text-allergy-foreground",
        tone === "muted" && "border-ink/30 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
