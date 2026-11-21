"use client";

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({
  id,
  label,
  help,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="font-semibold">
        {label}
      </Label>
      {children}
      {help ? (
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Dollars in the UI, integer cents in the database (CLAUDE.md §4). */
export function MoneyInput({
  id,
  cents,
  onChange,
  allowEmpty = false,
  allowNegative = false,
  ...rest
}: {
  id: string;
  cents: number | null;
  onChange: (cents: number | null) => void;
  allowEmpty?: boolean;
  allowNegative?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-semibold text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        inputMode="decimal"
        className="pl-7"
        defaultValue={cents === null ? "" : (cents / 100).toFixed(2)}
        onChange={(e) => {
          const raw = e.target.value.replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, "");
          if (raw === "" && allowEmpty) return onChange(null);
          const value = Math.round(Number.parseFloat(raw || "0") * 100);
          onChange(Number.isFinite(value) ? value : 0);
        }}
        {...rest}
      />
    </div>
  );
}

export function ChipToggle({
  pressed,
  onPressedChange,
  children,
  tone = "default",
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  children: ReactNode;
  tone?: "default" | "danger" | "warn";
}) {
  const on = tone === "danger" ? "bg-allergy text-white" : tone === "warn" ? "bg-[#e0a100] text-ink" : "bg-orange";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "min-h-11 rounded-full border-2 border-ink px-4 py-2 text-sm font-bold transition-[transform,box-shadow] hover:-translate-y-px",
        pressed ? cn(on, "shadow-ink-sm") : "bg-paper",
      )}
    >
      {children}
    </button>
  );
}

export { formatCents } from "@/lib/money";
