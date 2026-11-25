"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveEmailPreferences } from "@/app/(family)/account/actions";
import { Button } from "@/components/ui/button";

type Prefs = { menu_published: boolean; cutoff_reminders: boolean };

export function EmailPrefsForm({ initial, copy }: { initial: Prefs; copy: Record<string, string> }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();
  const topics = ["menu_published", "cutoff_reminders"] as const;
  return (
    <form
      className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5 shadow-ink"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveEmailPreferences(prefs);
          if (res.ok) toast.success(copy.saved);
          else toast.error(res.message);
        });
      }}
    >
      <fieldset className="space-y-4">
        <legend className="sr-only">{copy.title}</legend>
        {topics.map((topic) => (
          <label key={topic} className="flex items-start gap-3">
            <input
              type="checkbox"
              name={topic}
              className="mt-1 size-5 shrink-0 accent-ink"
              checked={prefs[topic]}
              aria-describedby={`${topic}-help`}
              onChange={(e) => setPrefs({ ...prefs, [topic]: e.target.checked })}
            />
            <span>
              <span className="block font-bold">{copy[topic]}</span>
              <span id={`${topic}-help`} className="block text-sm text-muted-foreground">
                {copy[`${topic}_help`]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {copy.save}
      </Button>
    </form>
  );
}
