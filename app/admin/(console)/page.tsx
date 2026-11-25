import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { AllergyFlags, dayLabel, KitchenHeader, Tile } from "@/components/kitchen/kit";
import { OrdersTable } from "@/components/kitchen/orders-table";
import { ActionButton } from "@/components/kitchen/toggles";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getCapacities, getKitchenSettings, getKitchenWeeks, getWeekLines, pickKitchenWeek } from "@/lib/kitchen/data";
import { cookable, isUnpaid, needsAttention, PAYMENT_LABEL, weekRows, weekSummary, whoFor } from "@/lib/kitchen/logic";
import { cutoffPassed, weekIsOpen } from "@/lib/kitchen/week";
import { todayInZone } from "@/lib/time";

import { BusinessOverview } from "./business-overview";
import { closeWeekNow, markWeekFulfilled } from "./kitchen/actions";

export const metadata = { title: "This week" };

/**
 * This Week (Phase 8): the owner's one screen for the week's orders, with
 * summary tiles, "needs attention" allergy conflicts and every order grouped
 * by day → destination. Kitchen staff get no prices or payment column.
 */
export default async function AdminThisWeekPage({ searchParams }: PageProps<"/admin">) {
  const user = await requireStaffAAL2();
  const isOps = user.roles.some((r) => r === "ops" || r === "owner");
  const isOwner = user.roles.includes("owner");
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const week = pickKitchenWeek(
    weeks,
    typeof sp.week === "string" ? sp.week : undefined,
    todayInZone("America/Los_Angeles"),
  );
  const [lines, capacities] = week
    ? await Promise.all([getWeekLines(week.id), getCapacities(week.id)])
    : [[], new Map()];
  const attention = needsAttention(lines);
  const summary = weekSummary(
    lines.filter((l) => !l.conflict),
    capacities,
  );
  const cooking = cookable(lines, settings);
  const unpaidHeld = settings.exclude_unpaid && week && cutoffPassed(week) ? lines.filter(isUnpaid).length : 0;
  const rows = weekRows(lines).map((r) => ({
    ...r,
    dateLabel: r.date ? dayLabel(r.date) : "No date",
    payment: isOps ? (PAYMENT_LABEL[r.status] ?? r.status) : undefined,
  }));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 text-base">
      <KitchenHeader
        title="This week"
        weeks={weeks}
        week={week}
        path="/admin"
        actions={
          week ? (
            <>
              {isOwner && weekIsOpen(week) ? (
                <ActionButton
                  run={() => closeWeekNow({ week_id: week.id })}
                  stepUp
                  confirm="Close this week now? Families and schools can't order or change anything after this. Plan meals are auto-filled first."
                >
                  Close week now
                </ActionButton>
              ) : null}
              {isOps && cutoffPassed(week) && week.status !== "fulfilled" ? (
                <ActionButton
                  run={() => markWeekFulfilled({ week_id: week.id })}
                  confirm="Mark every order this week as fulfilled?"
                >
                  Mark week fulfilled
                </ActionButton>
              ) : null}
            </>
          ) : null
        }
      />

      {!week ? <p className="text-lg">No published weeks yet.</p> : null}

      {attention.length ? (
        <section role="alert" className="rounded-2xl border-4 border-allergy bg-paper p-5">
          <h2 className="flex items-center gap-2 text-2xl font-black text-allergy">
            <AlertTriangle aria-hidden="true" className="size-7" /> Needs attention: {attention.length} meal
            {attention.length === 1 ? "" : "s"} clash with allergies
          </h2>
          <ul className="mt-2 space-y-1 text-lg">
            {attention.map((l) => (
              <li key={l.order_item_id}>
                <span className="font-bold">{whoFor(l)}</span> · {l.item_name} ·{" "}
                {l.delivery_date ? dayLabel(l.delivery_date) : ""} ·{" "}
                <span className="font-bold text-allergy">contains {l.conflict}</span> · {l.order_number}
              </li>
            ))}
          </ul>
          <Link
            href={week ? `/admin/kitchen/allergies?week=${week.id}` : "/admin/kitchen/allergies"}
            className="mt-2 inline-block font-bold underline print:hidden"
          >
            Open the allergy board
          </Link>
        </section>
      ) : null}

      {week ? (
        <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Meals this week"
            value={summary.meals}
            sub={
              <ul>
                {summary.byDay.map((d) => (
                  <li key={d.date}>
                    {dayLabel(d.date)}: <span className="font-bold">{d.meals}</span>
                  </li>
                ))}
              </ul>
            }
          />
          <Tile label="Families · schools" value={`${summary.families} · ${summary.schools}`} sub="meals" />
          <Tile
            label="Paid · invoiced · unpaid"
            value={`${summary.paid} · ${summary.invoiced} · ${summary.unpaid}`}
            sub={unpaidHeld ? `${unpaidHeld} unpaid meal line(s) are off the cook list (Settings → Kitchen)` : "meals"}
          />
          <Tile
            label="Children with allergies"
            value={summary.childrenWithAllergies}
            tone={summary.childrenWithAllergies ? "alert" : undefined}
            sub={
              <Link href={`/admin/kitchen/allergies?week=${week.id}`} className="underline print:hidden">
                Allergy board
              </Link>
            }
          />
        </section>
      ) : null}

      {summary.capacity.length ? (
        <section aria-labelledby="cap-h" className="rounded-2xl border-2 border-ink bg-paper p-5">
          <h2 id="cap-h" className="mb-3 text-xl font-black">
            Capacity used
          </h2>
          <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            {summary.capacity.map((c) => {
              const pct = c.capacity ? Math.min(100, Math.round((c.used / c.capacity) * 100)) : null;
              return (
                <li key={c.item}>
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{c.item}</span>
                    <span className="font-bold">
                      {c.used}
                      {c.capacity ? ` / ${c.capacity}` : ""}
                    </span>
                  </div>
                  {pct !== null ? (
                    <div className="mt-1 h-3 rounded-full border-2 border-ink bg-paper" aria-hidden="true">
                      <div
                        className={`h-full rounded-full ${pct >= 90 ? "bg-allergy" : "bg-orange"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {week ? (
        <section aria-label="Kitchen shortcuts" className="flex flex-wrap gap-2 print:hidden">
          {[
            [`/admin/kitchen?week=${week.id}`, `Cook list (${cooking.reduce((s, l) => s + l.quantity, 0)} meals)`],
            [`/admin/kitchen/allergies?week=${week.id}`, "Allergy board"],
            [`/admin/kitchen/labels?week=${week.id}`, "Labels"],
            [`/admin/kitchen/packing?week=${week.id}`, "Packing lists"],
            ...(isOps
              ? [
                  [`/admin/kitchen/manifest?week=${week.id}`, "Delivery manifest"],
                  [`/admin/kitchen/payments?week=${week.id}`, "Who has paid"],
                ]
              : []),
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              className="rounded-xl border-2 border-ink bg-orange px-4 py-3 text-lg font-bold shadow-ink-sm"
            >
              {label}
            </Link>
          ))}
        </section>
      ) : null}

      {week ? <OrdersTable rows={rows} showPayment={isOps} linkOrders={isOps} /> : null}

      <AllergyFlagsLegend />
      <BusinessOverview />
    </div>
  );
}

function AllergyFlagsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground print:hidden">
      Key:
      <AllergyFlags
        allergens={[
          { name: "Allergy", severity: "allergy" },
          { name: "Severe", severity: "severe" },
        ]}
      />
    </div>
  );
}
