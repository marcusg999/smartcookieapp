import type { MenuWeek } from "./queries";

/** Is the week still open for school changes (published, before cutoff)? Request time. */
export function isWeekOpen(w: Pick<MenuWeek, "status" | "cutoff">, now = Date.now()): boolean {
  return w.status === "published" && Date.parse(w.cutoff) > now;
}

/** The requested week, else the first still open for changes, else the latest. */
export function pickWeek(weeks: MenuWeek[], wanted: string, now = Date.now()): MenuWeek | undefined {
  return weeks.find((w) => w.id === wanted) ?? weeks.find((w) => Date.parse(w.cutoff) > now) ?? weeks.at(-1);
}

/** "This week": the week holding today, else the next delivery week. */
export function currentWeek(weeks: MenuWeek[], today: string): MenuWeek | undefined {
  return (
    weeks.find((w) => w.week_start <= today && w.delivery_dates.some((d) => d >= today)) ??
    weeks.find((w) => w.delivery_dates.some((d) => d >= today))
  );
}
