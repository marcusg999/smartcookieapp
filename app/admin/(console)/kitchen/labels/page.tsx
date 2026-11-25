import { Download, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { dayLabel, KitchenHeader } from "@/components/kitchen/kit";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getKitchenSettings, getKitchenWeeks, getWeekLines, pickKitchenWeek } from "@/lib/kitchen/data";
import { cookable, labelData } from "@/lib/kitchen/logic";
import { formatDay, todayInZone } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Meal labels" };

const SHEET_NAME = {
  avery_5163: 'Avery 5163 (2" × 4", 10 per sheet)',
  avery_5164: 'Avery 5164 (3⅓" × 4", 6 per sheet)',
};

/** Meal labels: preview and PDF download per day (or the whole week). */
export default async function LabelsPage({ searchParams }: PageProps<"/admin/kitchen/labels">) {
  await requireStaffAAL2();
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const week = pickKitchenWeek(
    weeks,
    typeof sp.week === "string" ? sp.week : undefined,
    todayInZone("America/Los_Angeles"),
  );
  const day = typeof sp.day === "string" ? sp.day : "";
  const all = labelData(cookable(week ? await getWeekLines(week.id) : [], settings), settings);
  const labels = day ? all.filter((l) => l.deliveryDate === day) : all;
  const perSheet = settings.label_sheet === "avery_5164" ? 6 : 10;
  const days = week?.delivery_dates ?? [];
  return (
    <div className="mx-auto w-full max-w-6xl text-lg">
      <KitchenHeader
        title="Meal labels"
        description={`Printed on ${SHEET_NAME[settings.label_sheet]}. Change the sheet and default use-by days in Settings → Kitchen; reheating notes per meal in Menu → Items.`}
        weeks={weeks}
        week={week}
        path="/admin/kitchen/labels"
        extraQuery={day ? `&day=${day}` : ""}
        actions={
          week ? (
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md border-2 border-ink bg-orange px-4 text-base font-bold shadow-ink-sm"
              href={`/admin/kitchen-export?kind=labels&week=${week.id}${day ? `&day=${day}` : ""}`}
            >
              <Download aria-hidden="true" className="size-4" /> Download labels PDF ({labels.length})
            </a>
          ) : null
        }
      />
      {week ? (
        <nav aria-label="Delivery day" className="mb-4 flex flex-wrap gap-2 print:hidden">
          {["", ...days].map((d) => (
            <Link
              key={d || "all"}
              href={`/admin/kitchen/labels?week=${week.id}${d ? `&day=${d}` : ""}`}
              aria-current={d === day ? "page" : undefined}
              className={cn(
                "rounded-full border-2 border-ink px-4 py-1.5 font-bold",
                d === day ? "bg-orange shadow-ink-sm" : "bg-paper",
              )}
            >
              {d ? formatDay(d) : "Whole week"}
            </Link>
          ))}
        </nav>
      ) : null}
      <p className="mb-4">
        {labels.length} label{labels.length === 1 ? "" : "s"} · {Math.ceil(labels.length / perSheet)} sheet
        {Math.ceil(labels.length / perSheet) === 1 ? "" : "s"}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Label preview">
        {labels.slice(0, 40).map((l, i) => (
          <li
            key={i}
            className={cn(
              "rounded-lg border-2 bg-paper p-3 text-base",
              l.severe ? "border-4 border-allergy" : "border-ink",
            )}
          >
            <p className="text-xl font-black">{l.name}</p>
            <p className="text-sm">{l.place}</p>
            <p className="font-bold">{l.meal}</p>
            <p className="text-sm">
              Delivered {dayLabel(l.deliveryDate)} · Use by {formatDay(l.useBy)}
            </p>
            <p className="text-sm font-bold text-allergy">
              {l.contains.length ? `CONTAINS: ${l.contains.join(", ")}` : "CONTAINS: none of the listed allergens"}
              {l.mayContain.length ? ` · MAY CONTAIN: ${l.mayContain.join(", ")}` : ""}
            </p>
            {l.preparedSafeFor.length ? (
              <p className="text-sm font-black text-allergy">
                PREPARED ALLERGY-SAFE FOR: {l.preparedSafeFor.join(", ")}
              </p>
            ) : null}
            {l.severe ? (
              <p className="flex items-center gap-1 text-sm font-black text-allergy">
                <ShieldAlert aria-hidden="true" className="size-4" /> Severe allergy: check before serving
              </p>
            ) : null}
            {l.reheat ? <p className="text-sm italic">{l.reheat}</p> : null}
          </li>
        ))}
      </ul>
      {labels.length > 40 ? (
        <p className="mt-3 text-base text-muted-foreground">Showing the first 40. The PDF has all {labels.length}.</p>
      ) : null}
    </div>
  );
}
