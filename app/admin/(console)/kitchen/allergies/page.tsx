import { AlertTriangle, ShieldAlert } from "lucide-react";

import { AllergyFlags, dayLabel, KitchenHeader } from "@/components/kitchen/kit";
import { ActionButton, PrepCheck } from "@/components/kitchen/toggles";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getKitchenSettings, getKitchenWeeks, getWeekLines, pickKitchenWeek } from "@/lib/kitchen/data";
import { allergyBoard, cookable, destination, needsAttention, whoFor } from "@/lib/kitchen/logic";
import { todayInZone } from "@/lib/time";
import { cn } from "@/lib/utils";

import { runConflictCheck } from "../actions";

export const metadata = { title: "Allergy board" };

/**
 * Allergy Board (CLAUDE.md §6): every child with an allergy who has a meal
 * this week, severe in red with an icon, owner overrides shown, and a prep
 * check per flagged meal (logged with who and when). Conflicts that slipped
 * through (an allergy added after ordering) are at the top.
 */
export default async function AllergyBoardPage({ searchParams }: PageProps<"/admin/kitchen/allergies">) {
  const user = await requireStaffAAL2();
  const isOps = user.roles.some((r) => r === "ops" || r === "owner");
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const week = pickKitchenWeek(
    weeks,
    typeof sp.week === "string" ? sp.week : undefined,
    todayInZone("America/Los_Angeles"),
  );
  const lines = week ? await getWeekLines(week.id) : [];
  const attention = needsAttention(lines);
  const board = allergyBoard(cookable(lines, settings));
  const meals = board.reduce((s, b) => s + b.meals.length, 0);
  const checked = board.reduce((s, b) => s + b.meals.filter((m) => m.line.prep_checked_at).length, 0);
  return (
    <div className="mx-auto w-full max-w-6xl text-lg">
      <KitchenHeader
        title="Allergy board"
        description="Tick each flagged meal once it's been prepared allergy-safe. Every tick is logged with your name and the time."
        weeks={weeks}
        week={week}
        path="/admin/kitchen/allergies"
        actions={isOps ? <ActionButton run={() => runConflictCheck({})}>Check for new conflicts</ActionButton> : null}
      />

      <section
        aria-labelledby="attention-h"
        className={cn("mb-8 rounded-2xl border-4 p-5", attention.length ? "border-allergy" : "border-ink/30")}
      >
        <h2
          id="attention-h"
          className={cn("flex items-center gap-2 text-2xl font-black", attention.length && "text-allergy")}
        >
          <AlertTriangle aria-hidden="true" className="size-7" /> Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="mt-1">Nothing clashes with any child&apos;s current allergies.</p>
        ) : (
          <>
            <p className="mt-1">
              These meals now clash with a child&apos;s allergies (for example, an allergy added after ordering). They
              are NOT on the cook list or labels. The owner and the parent have been emailed; swap or cancel the meal
              from the order.
            </p>
            <ul className="mt-3 space-y-2">
              {attention.map((l) => (
                <li key={l.order_item_id} className="rounded-xl border-2 border-allergy p-3">
                  <span className="text-xl font-black">{whoFor(l)}</span> · {destination(l)}
                  <br />
                  {l.item_name} · {l.delivery_date ? dayLabel(l.delivery_date) : ""} · order {l.order_number} ·{" "}
                  <span className="font-black text-allergy">contains {l.conflict}</span>
                  <AllergyFlags allergens={l.child_allergens} className="mt-1" />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p className="mb-4 text-xl font-bold print:hidden" aria-live="polite">
        Prep checks: {checked} of {meals} flagged meals
      </p>
      {board.length === 0 ? <p>No children with allergies have meals this week.</p> : null}
      <ul className="space-y-4">
        {board.map((b) => (
          <li
            key={b.childKey}
            className={cn(
              "break-inside-avoid rounded-2xl border-2 bg-paper p-4",
              b.severe ? "border-4 border-allergy" : "border-ink",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-2xl font-black">
                  {b.severe ? <ShieldAlert aria-label="Severe allergy" className="size-7 text-allergy" /> : null}
                  {b.name}
                </h2>
                <p className="text-base text-muted-foreground">{b.place}</p>
              </div>
              <AllergyFlags allergens={b.allergens} />
            </div>
            <ul className="mt-3 divide-y-2 divide-ink/10">
              {b.meals.map(({ line, prep }) => (
                <li key={line.order_item_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-xl font-bold">
                      {line.delivery_date ? dayLabel(line.delivery_date) : ""} · {line.item_name}
                      {line.quantity > 1 ? ` ×${line.quantity}` : ""}
                    </p>
                    {prep.length ? (
                      <p className="font-black text-allergy">Prepare allergy-safe for: {prep.join(", ")}</p>
                    ) : (
                      <p className="text-base text-muted-foreground">Doesn&apos;t contain their allergens</p>
                    )}
                    {line.has_allergy_override ? (
                      <p className="text-base font-bold">Owner-approved exception: {line.override_reason}</p>
                    ) : null}
                  </div>
                  {prep.length ? (
                    <PrepCheck
                      itemId={line.order_item_id}
                      checked={Boolean(line.prep_checked_at)}
                      by={line.prep_checked_by}
                      label={`Prepared allergy-safe: ${b.name}, ${line.item_name}, ${line.delivery_date ?? ""}`}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
