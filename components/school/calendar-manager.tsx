"use client";

import { CalendarX, Trash2 } from "lucide-react";
import { useState } from "react";

import { setClosure } from "@/app/(school)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/time";

import { Field, Panel, useRun, type Copy } from "./kit";

/** School calendar: closure days are skipped by every standing order. */
export function CalendarManager({
  copy,
  closures,
  isAdmin,
  minDate,
}: {
  copy: Copy;
  closures: { id: string; closure_date: string; reason: string | null }[];
  isAdmin: boolean;
  minDate: string;
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const { pending, run } = useRun(copy);
  const upcoming = closures.filter((c) => c.closure_date >= minDate);
  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Panel>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => setClosure({ date, reason, closed: true }),
                copy["calendar.added"],
                (r) => {
                  if (r.ok) {
                    setDate("");
                    setReason("");
                  }
                },
              );
            }}
          >
            <Field id="closure-date" label={copy["calendar.date"]}>
              <Input
                id="closure-date"
                type="date"
                min={minDate}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </Field>
            <Field id="closure-reason" label={copy["calendar.reason"]} className="min-w-56 flex-1">
              <Input
                id="closure-reason"
                value={reason}
                maxLength={120}
                placeholder={copy["calendar.reason_placeholder"]}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={pending || !date}>
              <CalendarX aria-hidden="true" /> {copy["calendar.add"]}
            </Button>
          </form>
          <p className="mt-2 text-sm text-muted-foreground">{copy["calendar.help"]}</p>
        </Panel>
      ) : null}
      {upcoming.length === 0 ? (
        <p className="text-muted-foreground">{copy["calendar.empty"]}</p>
      ) : (
        <ul className="divide-y-2 divide-ink/10 rounded-2xl border-2 border-ink bg-paper">
          {upcoming.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-3">
              <span>
                <span className="font-semibold">
                  {formatDay(c.closure_date, { weekday: "long", month: "long", day: "numeric" })}
                </span>
                {c.reason ? <span className="text-muted-foreground"> · {c.reason}</span> : null}
              </span>
              {isAdmin ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={copy["calendar.remove"]}
                  disabled={pending}
                  onClick={() =>
                    run(() => setClosure({ date: c.closure_date, reason: "", closed: false }), copy["calendar.removed"])
                  }
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
