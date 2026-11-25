"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { grantLateOrder, revokeLateOrder } from "@/app/admin/(console)/kitchen/actions";
import { Field } from "@/components/admin/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Week = { id: string; label: string };
type Exception = { id: string; week_label: string; expires_at: string; reason: string; active: boolean };

/** Owner-only: let this family order for a week after its cutoff (audited). */
export function LateOrderTool({
  householdId,
  weeks,
  exceptions,
}: {
  householdId: string;
  weeks: Week[];
  exceptions: Exception[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [week, setWeek] = useState(weeks[0]?.id ?? "");
  const [hours, setHours] = useState(24);
  const [reason, setReason] = useState("");
  return (
    <section aria-labelledby="late-h" className="space-y-3 rounded-2xl border-2 border-ink bg-paper p-5">
      <h2 id="late-h" className="text-xl font-bold">
        Late order exception
      </h2>
      <p className="text-sm text-muted-foreground">
        Lets this family order for a week after its cutoff, until the time runs out. Recorded in the audit log.
      </p>
      {weeks.length === 0 ? (
        <p className="text-sm">No weeks past their cutoff right now.</p>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_8rem_2fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await grantLateOrder({ week_id: week, household_id: householdId, reason, hours });
              if (r.ok) {
                toast.success(r.message);
                setReason("");
              } else toast.error(r.message);
              router.refresh();
            });
          }}
        >
          <Field id="late-week" label="Week">
            <select
              id="late-week"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="h-11 w-full rounded-md border-2 border-ink bg-card px-3"
            >
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="late-hours" label="Hours">
            <Input
              id="late-hours"
              type="number"
              min={1}
              max={72}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </Field>
          <Field id="late-reason" label="Reason">
            <Input
              id="late-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={pending || reason.trim().length < 3}>
            Allow late order
          </Button>
        </form>
      )}
      {exceptions.length ? (
        <ul className="divide-y divide-ink/10 text-sm">
          {exceptions.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {x.week_label} · until {x.expires_at} · {x.reason} {x.active ? "" : "(ended)"}
              </span>
              {x.active ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await revokeLateOrder({ exception_id: x.id });
                      if (r.ok) toast.success(r.message);
                      else toast.error(r.message);
                      router.refresh();
                    })
                  }
                >
                  End now
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
