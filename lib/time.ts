/**
 * Business-timezone helpers (CLAUDE.md §4: cutoffs are computed and shown in
 * the business timezone, America/Los_Angeles by default).
 */

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Offset of `timeZone` from UTC at `date`, in minutes. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** ISO instant → value for <input type="datetime-local"> in the business timezone. */
export function toZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const p = partsIn(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

/** <input type="datetime-local"> value interpreted in the business timezone → ISO instant. */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Two passes handle DST boundaries.
  let instant = new Date(guess.getTime() - tzOffsetMinutes(guess, timeZone) * 60000);
  instant = new Date(guess.getTime() - tzOffsetMinutes(instant, timeZone) * 60000);
  return instant.toISOString();
}

const DEFAULT_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/**
 * Friendly display, e.g. "Thu, Nov 26, 6:00 PM PST". Options, when given,
 * REPLACE the default fields (Intl rejects dateStyle mixed with weekday etc.).
 */
export function formatInZone(
  iso: string | null | undefined,
  timeZone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(opts && Object.keys(opts).length ? opts : DEFAULT_FORMAT),
  }).format(new Date(iso));
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayInZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "2026-11-30" → "Mon, Nov 30" (date-only values are calendar dates, no timezone shift). */
export function formatDay(
  date: string,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
