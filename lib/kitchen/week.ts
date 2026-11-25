import type { KitchenWeek } from "./data";

/** Is ordering still open for this week? (Request time; kept out of components.) */
export function weekIsOpen(w: Pick<KitchenWeek, "status" | "cutoff">, now = Date.now()): boolean {
  return w.status === "published" && Date.parse(w.cutoff) > now;
}

export function cutoffPassed(w: Pick<KitchenWeek, "cutoff">, now = Date.now()): boolean {
  return Date.parse(w.cutoff) <= now;
}
