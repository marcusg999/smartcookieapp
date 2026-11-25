/** Display status for an invoice: an open invoice past its due date is overdue. */
export function invoiceState<S extends string>(
  i: { status: S; due_date: string | null },
  today: string,
): S | "overdue" {
  if (i.status === "open" && i.due_date && i.due_date < today) return "overdue";
  return i.status;
}

/** Previous calendar month for a business-timezone date: the monthly invoice period. */
export function previousMonth(today: string): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Days past due (0 when not yet due). */
export function daysOverdue(due: string | null, today: string): number {
  if (!due) return 0;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000));
}
