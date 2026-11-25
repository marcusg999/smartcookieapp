import { dayLabel, KitchenHeader } from "@/components/kitchen/kit";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getKitchenSettings, getKitchenWeeks, getWeekLines, pickKitchenWeek } from "@/lib/kitchen/data";
import { cookable, dietaryRollup } from "@/lib/kitchen/logic";
import { formatDay, todayInZone } from "@/lib/time";

export const metadata = { title: "Dietary roll-up" };

/** One-series horizontal bars: the value is printed beside each bar (never colour alone). */
function Bars({
  rows,
  tone,
  unit,
}: {
  rows: { label: string; value: number; note?: string }[];
  tone: "orange" | "allergy";
  unit: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(8rem,12rem)_1fr_auto] items-center gap-3">
          <span className="font-semibold">{r.label}</span>
          <span className="h-5 rounded-r border-l-2 border-ink" aria-hidden="true">
            <span
              title={`${r.label}: ${r.value} ${unit}`}
              className={`block h-full rounded-r-[4px] ${tone === "allergy" ? "bg-allergy" : "bg-orange"}`}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right font-bold tabular-nums">
            {r.value} {unit}
            {r.note ? <span className="ml-1 text-sm font-semibold text-allergy">{r.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Dietary roll-up: badge counts per day, children's preferences, allergen totals for the week. */
export default async function DietaryPage({ searchParams }: PageProps<"/admin/kitchen/dietary">) {
  await requireStaffAAL2();
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const week = pickKitchenWeek(
    weeks,
    typeof sp.week === "string" ? sp.week : undefined,
    todayInZone("America/Los_Angeles"),
  );
  const r = dietaryRollup(cookable(week ? await getWeekLines(week.id) : [], settings));
  const card = "break-inside-avoid rounded-2xl border-2 border-ink bg-paper p-5";
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 text-lg">
      <KitchenHeader title="Dietary roll-up" weeks={weeks} week={week} path="/admin/kitchen/dietary" />
      <section className={card} aria-labelledby="badges-h">
        <h2 id="badges-h" className="mb-3 text-2xl font-black">
          Meals by dietary badge
        </h2>
        {r.badges.length === 0 ? (
          <p>No badged meals this week.</p>
        ) : (
          <>
            <Bars rows={r.badges.map((b) => ({ label: b.name, value: b.total }))} tone="orange" unit="meals" />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-base">
                <caption className="sr-only">Meals by dietary badge per delivery day</caption>
                <thead>
                  <tr className="border-b-2 border-ink">
                    <th className="py-1">Badge</th>
                    {r.days.map((d) => (
                      <th key={d} className="text-right">
                        {formatDay(d)}
                      </th>
                    ))}
                    <th className="text-right">Week</th>
                  </tr>
                </thead>
                <tbody>
                  {r.badges.map((b) => (
                    <tr key={b.name} className="border-b border-ink/10">
                      <td className="py-1 font-semibold">{b.name}</td>
                      {r.days.map((d) => (
                        <td key={d} className="text-right tabular-nums">
                          {b.perDay[d] ?? 0}
                        </td>
                      ))}
                      <td className="text-right font-bold tabular-nums">{b.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={card} aria-labelledby="allergen-h">
          <h2 id="allergen-h" className="mb-1 text-2xl font-black">
            Children with each allergy
          </h2>
          <p className="mb-3 text-base text-muted-foreground">Named children with a meal this week.</p>
          {r.allergenChildren.length ? (
            <Bars
              rows={r.allergenChildren.map((a) => ({
                label: a.name,
                value: a.children,
                note: a.severe ? `${a.severe} severe` : undefined,
              }))}
              tone="allergy"
              unit="children"
            />
          ) : (
            <p>None this week.</p>
          )}
        </section>
        <section className={card} aria-labelledby="contains-h">
          <h2 id="contains-h" className="mb-1 text-2xl font-black">
            Meals containing each allergen
          </h2>
          <p className="mb-3 text-base text-muted-foreground">
            All meals this week ({r.days.map((d) => dayLabel(d)).length} days).
          </p>
          {r.allergenMeals.length ? (
            <Bars rows={r.allergenMeals.map((a) => ({ label: a.name, value: a.meals }))} tone="allergy" unit="meals" />
          ) : (
            <p>None.</p>
          )}
        </section>
      </div>
      {r.preferences.length ? (
        <section className={card} aria-labelledby="prefs-h">
          <h2 id="prefs-h" className="mb-3 text-2xl font-black">
            Children&apos;s dietary preferences
          </h2>
          <Bars rows={r.preferences.map((p) => ({ label: p.name, value: p.children }))} tone="orange" unit="children" />
        </section>
      ) : null}
    </div>
  );
}
