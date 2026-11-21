import Link from "next/link";

import { MealCard } from "@/components/menu/meal-card";
import { RichText } from "@/components/rich-text";
import { getUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getPublicSettings } from "@/lib/content/settings";
import { getPublishedWeeks, getWeekForPreview, type PublicWeek } from "@/lib/menu/queries";
import { formatDay, formatInZone } from "@/lib/time";

export const metadata = { title: "Menu" };

const TILTS = [-1.2, 1.4, -0.8];
const UUID = /^[0-9a-f-]{36}$/i;

export default async function MenuPage({ searchParams }: PageProps<"/menu">) {
  const sp = await searchParams;
  const [c, settings, published] = await Promise.all([
    getContent(),
    getPublicSettings().catch(() => null),
    getPublishedWeeks().catch(() => []),
  ]);

  // Owner preview of an unpublished week (/menu?preview=<id>), read with the
  // owner's own session so RLS decides; everyone else sees published weeks.
  let preview: PublicWeek | null = null;
  if (typeof sp.preview === "string" && UUID.test(sp.preview)) {
    const user = await getUser();
    if (user?.aal === "aal2" && user.roles.includes("owner")) preview = await getWeekForPreview(sp.preview);
  }
  const weeks = preview ? [preview] : published;
  const week = weeks.find((w) => w.id === sp.week) ?? weeks[0];
  const meals = (week?.meals ?? []).filter((m) => m.available_for !== "schools");
  const labels = {
    contains: c.text("menu.contains_label"),
    mayContain: c.text("menu.may_contain_label"),
    noAllergens: c.text("menu.no_allergens_label"),
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      {preview ? (
        <p role="status" className="mb-6 rounded-xl border-2 border-ink bg-accent px-4 py-2 font-semibold">
          {c.text("banner.preview_mode")}
        </p>
      ) : null}
      <div className="grid grid-cols-12 items-end gap-4">
        <h1 className="col-span-12 text-5xl leading-[0.95] font-black md:col-span-8 md:text-7xl">
          {c.text("menu.title")}
        </h1>
        <p className="col-span-12 text-muted-foreground md:col-span-4 md:pb-2">{c.text("menu.subtitle")}</p>
      </div>

      {settings && !settings.ordering_enabled ? (
        <p
          role="status"
          className="mt-6 rounded-xl border-2 border-ink bg-orange px-4 py-3 font-semibold shadow-ink-sm"
        >
          {settings.ordering_paused_message}
        </p>
      ) : null}

      {weeks.length > 1 ? (
        <nav aria-label="Menu weeks" className="-mx-4 mt-8 overflow-x-auto px-4 pb-2">
          <ul className="flex gap-2">
            {weeks.map((w) => (
              <li key={w.id} className="shrink-0">
                <Link
                  href={`/menu?week=${w.id}`}
                  scroll={false}
                  aria-current={w.id === week?.id ? "page" : undefined}
                  className={`block rounded-full border-2 border-ink px-4 py-1.5 font-semibold ${w.id === week?.id ? "bg-orange shadow-ink-sm" : "bg-paper"}`}
                >
                  {formatDay(w.week_start, { month: "short", day: "numeric" })}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {!week || meals.length === 0 ? (
        <p className="mt-10 rounded-2xl border-2 border-dashed border-ink/40 bg-paper p-8 text-center text-lg">
          {c.text("menu.empty")}
        </p>
      ) : (
        <section aria-labelledby="week-heading" className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="week-heading" className="text-3xl font-black md:text-4xl">
              {formatDay(week.week_start, { month: "long", day: "numeric" })}
            </h2>
            {week.cutoff ? (
              <p className="rounded-full border-2 border-ink bg-paper px-3 py-1 text-sm font-bold">
                {c.text("menu.cutoff_label", {
                  date: formatInZone(week.cutoff, settings?.timezone ?? "America/Los_Angeles", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                })}
              </p>
            ) : null}
          </div>
          {week.notes_to_families ? <p className="mt-3 max-w-2xl leading-relaxed">{week.notes_to_families}</p> : null}
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            {meals.map((meal, i) => (
              <MealCard
                key={meal.id}
                meal={meal}
                labels={labels}
                tilt={TILTS[i % TILTS.length]}
                className={i % 2 ? "sm:mt-10" : ""}
              />
            ))}
          </div>
        </section>
      )}

      <RichText
        doc={c.rich("menu.allergen_disclaimer")}
        className="mt-12 rounded-xl border-2 border-ink bg-paper p-4 text-sm leading-relaxed shadow-ink-sm"
      />
    </div>
  );
}
