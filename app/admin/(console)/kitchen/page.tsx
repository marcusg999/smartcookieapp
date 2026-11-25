import { Download } from "lucide-react";

import { dayLabel, KitchenHeader } from "@/components/kitchen/kit";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getKitchenSettings, getKitchenWeeks, getWeekLines, pickKitchenWeek } from "@/lib/kitchen/data";
import { cookable, cookList, isUnpaid, needsAttention, whoFor } from "@/lib/kitchen/logic";
import { todayInZone } from "@/lib/time";

export const metadata = { title: "Cook list" };

const btn = "inline-flex min-h-11 items-center gap-2 rounded-md border-2 border-ink bg-paper px-4 text-base font-bold";

/** Cook list: per day, each item × total, split into standard vs allergy-modified. */
export default async function CookListPage({ searchParams }: PageProps<"/admin/kitchen">) {
  await requireStaffAAL2();
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const week = pickKitchenWeek(
    weeks,
    typeof sp.week === "string" ? sp.week : undefined,
    todayInZone("America/Los_Angeles"),
  );
  const lines = week ? await getWeekLines(week.id) : [];
  const rows = cookList(cookable(lines, settings));
  const days = [...new Set(rows.map((r) => r.date))];
  const unpaid = settings.exclude_unpaid ? lines.filter(isUnpaid) : [];
  const conflicts = needsAttention(lines);
  return (
    <div className="mx-auto w-full max-w-5xl text-lg">
      <KitchenHeader
        title="Cook list"
        description="Totals per day. Allergy-modified meals are counted separately and must be prepared safe for the listed allergens."
        weeks={weeks}
        week={week}
        path="/admin/kitchen"
        actions={
          week ? (
            <>
              <a className={btn} href={`/admin/kitchen-export?kind=cook-pdf&week=${week.id}`}>
                <Download aria-hidden="true" className="size-4" /> PDF
              </a>
              <a className={btn} href={`/admin/kitchen-export?kind=cook-csv&week=${week.id}`}>
                <Download aria-hidden="true" className="size-4" /> CSV
              </a>
            </>
          ) : null
        }
      />
      {conflicts.length ? (
        <p role="alert" className="mb-6 rounded-xl border-4 border-allergy p-3 font-bold text-allergy">
          {conflicts.length} meal(s) are left off this list because they clash with a child&apos;s allergies. See the
          allergy board.
        </p>
      ) : null}
      {days.length === 0 ? <p>Nothing to cook for this week yet.</p> : null}
      {days.map((d) => (
        <section key={d} className="mb-8 break-inside-avoid" aria-labelledby={`day-${d}`}>
          <h2 id={`day-${d}`} className="border-b-4 border-ink pb-1 text-3xl font-black">
            {dayLabel(d)}
          </h2>
          <table className="mt-2 w-full table-fixed text-left">
            <thead>
              <tr className="border-b-2 border-ink text-sm uppercase">
                <th className="w-[40%] py-2">Meal</th>
                <th className="w-[14%] text-right">Total</th>
                <th className="w-[14%] text-right">Standard</th>
                <th className="pl-6">Allergy-modified</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.date === d)
                .map((r) => (
                  <tr key={r.item} className="border-b border-ink/20 align-top">
                    <td className="py-3 text-xl font-bold">{r.item}</td>
                    <td className="py-3 text-right text-3xl font-black">{r.total}</td>
                    <td className="py-3 text-right text-xl">{r.standard}</td>
                    <td className="py-3 pl-6">
                      {r.modifications.length ? (
                        <ul className="font-black text-allergy">
                          {r.modifications.map((m) => (
                            <li key={m.label}>
                              {m.count} × {m.label}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      {unpaid.length ? (
        <section
          className="mt-10 rounded-2xl border-2 border-dashed border-ink p-4 print:hidden"
          aria-labelledby="unpaid-h"
        >
          <h2 id="unpaid-h" className="text-xl font-black">
            Unpaid orders (not on the cook list)
          </h2>
          <p className="text-base text-muted-foreground">
            Settings → Kitchen keeps unpaid à-la-carte orders off the cook list. They&apos;re added automatically once
            paid.
          </p>
          <ul className="mt-2 text-base">
            {unpaid.map((l) => (
              <li key={l.order_item_id}>
                {l.order_number} · {whoFor(l)} · {l.item_name} ×{l.quantity} ·{" "}
                {l.delivery_date ? dayLabel(l.delivery_date) : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
