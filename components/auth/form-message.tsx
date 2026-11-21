import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { ActionResult } from "@/lib/auth/action-result";
import { cn } from "@/lib/utils";

/** Announces form results to screen readers (role="status"/"alert"). */
export function FormMessage({ state, className }: { state: ActionResult | null; className?: string }) {
  if (!state || (state.ok && !state.message)) return null;
  const ok = state.ok;
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={ok ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        ok
          ? "border-accent bg-accent/50 text-accent-foreground"
          : "border-destructive/30 bg-destructive/5 text-destructive",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>{state.message}</p>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}
