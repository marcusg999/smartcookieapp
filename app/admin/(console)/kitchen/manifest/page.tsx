import Link from "next/link";

import { KitchenHeader } from "@/components/kitchen/kit";
import { DeliveredToggle } from "@/components/kitchen/toggles";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import {
  getKitchenSettings,
  getKitchenWeeks,
  getWeekLines,
  getWeekOpsOrders,
  pickKitchenWeek,
} from "@/lib/kitchen/data";
import { cookable, manifest } from "@/lib/kitchen/logic";
import { formatDay, todayInZone } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Delivery manifest" };

/**
 * Delivery manifest (ops/owner): stops grouped by zone and ordered by ZIP,
 * with address, notes, phone and bag count. "Mark delivered" works from a
 * phone and emails the family.
 */
export default async function ManifestPage({ searchParams }: PageProps<"/admin/kitchen/manifest">) {
  await requireStaffAAL2(["ops", "owner"]);
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const today = todayInZone("America/Los_Angeles");
  const week = pickKitchenWeek(weeks, typeof sp.week === "string" ? sp.week : undefined, today);
  const days = week?.delivery_dates ?? [];
  const day =
    typeof sp.day === "string" && days.includes(sp.day) ? sp.day : (days.find((d) => d >= today) ?? days[0] ?? "");
  const [lines, orders] = week ? await Promise.all([getWeekLines(week.id), getWeekOpsOrders(week.id)]) : [[], []];
  const stops = day ? manifest(orders, cookable(lines, settings), day, settings) : [];
  const zones = [...new Set(stops.map((s) => s.zone))];
  const done = stops.filter((s) => s.delivered).length;
  return (
    <div className="mx-auto w-full max-w-3xl text-lg">
      <KitchenHeader
        title="Delivery manifest"
        weeks={weeks}
        week={week}
        path="/admin/kitchen/manifest"
        extraQuery={day ? `&day=${day}` : ""}
      />
      {week ? (
        <nav aria-label="Delivery day" className="mb-4 flex flex-wrap gap-2 print:hidden">
          {days.map((d) => (
            <Link
              key={d}
              href={`/admin/kitchen/manifest?week=${week.id}&day=${d}`}
              aria-current={d === day ? "page" : undefined}
              className={cn(
                "min-h-11 rounded-full border-2 border-ink px-4 py-2 font-bold",
                d === day ? "bg-orange shadow-ink-sm" : "bg-paper",
              )}
            >
              {formatDay(d)}
            </Link>
          ))}
        </nav>
      ) : null}
      <p className="mb-4 text-xl font-bold" aria-live="polite">
        {done} of {stops.length} stops delivered
      </p>
      {stops.length === 0 ? <p>No deliveries on this day.</p> : null}
      {zones.map((z) => (
        <section key={z} aria-labelledby={`zone-${z}`} className="mb-6">
          <h2 id={`zone-${z}`} className="border-b-4 border-ink text-2xl font-black">
            {z}
          </h2>
          <ol className="divide-y-2 divide-ink/15">
            {stops
              .filter((s) => s.zone === z)
              .map((s) => (
                <li key={s.key} className="break-inside-avoid py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xl font-black">{s.name}</p>
                      <p>{s.address || "No address on file"}</p>
                      {s.notes ? <p className="text-base">Notes: {s.notes}</p> : null}
                      <p className="text-base">
                        {s.phone ? (
                          <a href={`tel:${s.phone.replace(/[^\d+]/g, "")}`} className="font-bold underline">
                            {s.phone}
                          </a>
                        ) : (
                          "No phone"
                        )}{" "}
                        · {s.bags} bag{s.bags === 1 ? "" : "s"} · {s.orderNumbers.join(", ")}
                      </p>
                    </div>
                    <DeliveredToggle
                      orderIds={s.orderIds}
                      date={day}
                      delivered={s.delivered}
                      label={`${s.delivered ? "Undo delivered" : "Mark delivered"}: ${s.name}`}
                    />
                  </div>
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
