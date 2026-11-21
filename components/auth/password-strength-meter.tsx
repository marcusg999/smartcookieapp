"use client";

import { passwordStrength } from "@/lib/auth/password";
import { cn } from "@/lib/utils";

const COLORS = ["bg-destructive", "bg-destructive", "bg-chart-3", "bg-chart-2", "bg-chart-2"];

export function PasswordStrengthMeter({ password, id }: { password: string; id: string }) {
  if (!password) return null;
  const { score, label, hints } = passwordStrength(password);
  return (
    <div id={id} className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full bg-muted", i < Math.max(1, score) && COLORS[score])} />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Strength: <span className="font-medium text-foreground">{label}</span>
        {hints[0] ? ` · ${hints[0]}` : ""}
      </p>
    </div>
  );
}
