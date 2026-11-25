import { dayLabel, KitchenHeader } from "@/components/kitchen/kit";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getKitchenSettings, getKitchenWeeks, getWeekLines, pickKitchenWeek } from "@/lib/kitchen/data";
import { cookable, packingLists } from "@/lib/kitchen/logic";
import { todayInZone } from "@/lib/time";

export const metadata = { title: "Packing lists" };

/** Packing lists: per school → per classroom (bag counts), and per delivery route for households. */
export default async function PackingPage({ searchParams }: PageProps<"/admin/kitchen/packing">) {
  await requireStaffAAL2();
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const week = pickKitchenWeek(
    weeks,
    typeof sp.week === "string" ? sp.week : undefined,
    todayInZone("America/Los_Angeles"),
  );
  const { schools, routes } = packingLists(cookable(week ? await getWeekLines(week.id) : [], settings), settings);
  const card = "break-inside-avoid rounded-2xl border-2 border-ink bg-paper p-5";
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 text-lg">
      <KitchenHeader
        title="Packing lists"
        description={`School bags hold up to ${settings.meals_per_bag} meals (Settings → Kitchen). Named allergy-safe meals are packed separately and labelled.`}
        weeks={weeks}
        week={week}
        path="/admin/kitchen/packing"
      />
      <section aria-labelledby="schools-h" className="space-y-4">
        <h2 id="schools-h" className="text-3xl font-black">
          Schools
        </h2>
        {schools.length === 0 ? <p>No school deliveries this week.</p> : null}
        {schools.map((s) => (
          <div key={s.name} className={card}>
            <h3 className="text-2xl font-black">{s.name}</h3>
            {s.days.map((d) => (
              <div key={d.date} className="mt-3">
                <h4 className="border-b-2 border-ink text-xl font-bold">{dayLabel(d.date)}</h4>
                <table className="mt-1 w-full text-left">
                  <thead>
                    <tr className="text-sm uppercase">
                      <th className="py-1">Classroom</th>
                      <th className="text-right">Meals</th>
                      <th className="text-right">Allergy-safe</th>
                      <th className="text-right">Bags</th>
                      <th className="w-10 text-right">
                        <span className="sr-only">Packed</span>✓
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.classrooms.map((c) => (
                      <tr key={c.name} className="border-t border-ink/20 align-top">
                        <td className="py-2">
                          <span className="font-bold">{c.name}</span>
                          {c.named.length ? (
                            <span className="block text-base text-allergy">Named: {c.named.join(", ")}</span>
                          ) : null}
                        </td>
                        <td className="py-2 text-right text-2xl font-black">{c.meals}</td>
                        <td className="py-2 text-right font-bold text-allergy">{c.safe || ""}</td>
                        <td className="py-2 text-right text-2xl font-black">{c.bags}</td>
                        <td className="py-2 text-right">
                          <span aria-hidden="true" className="inline-block size-6 rounded border-2 border-ink" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </section>
      <section aria-labelledby="routes-h" className="space-y-4">
        <h2 id="routes-h" className="text-3xl font-black">
          Home delivery routes
        </h2>
        {routes.length === 0 ? <p>No home deliveries this week.</p> : null}
        {routes.map((r) => (
          <div key={r.zone} className={card}>
            <h3 className="text-2xl font-black">{r.zone}</h3>
            {r.days.map((d) => (
              <div key={d.date} className="mt-3">
                <h4 className="border-b-2 border-ink text-xl font-bold">
                  {dayLabel(d.date)} · {d.households.length} bag{d.households.length === 1 ? "" : "s"}
                </h4>
                <ul className="divide-y divide-ink/20">
                  {d.households.map((h) => (
                    <li key={h.orderNumber} className="flex items-start justify-between gap-3 py-2">
                      <div>
                        <p className="font-bold">
                          {h.name} · {h.orderNumber}
                        </p>
                        <ul className="text-base">
                          {h.items.map((i, n) => (
                            <li key={n}>{i}</li>
                          ))}
                        </ul>
                      </div>
                      <span
                        aria-hidden="true"
                        className="mt-1 inline-block size-6 shrink-0 rounded border-2 border-ink"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
