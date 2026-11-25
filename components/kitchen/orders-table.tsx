"use client";

import { AlertTriangle, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import type { ChildAllergy } from "@/lib/kitchen/logic";
import { cn } from "@/lib/utils";

export type WeekRow = {
  key: string;
  date: string;
  dateLabel: string;
  destination: string;
  orderId: string;
  orderNumber: string;
  customer: string;
  children: string[];
  items: string[];
  flags: ChildAllergy[];
  conflict: boolean;
  modified: boolean;
  school: boolean;
  payment?: string;
  notes: string | null;
};

/**
 * Every order on one screen: grouped by delivery day → destination, with
 * search and filters. `showPayment` is false for kitchen staff (no payment
 * column at all, and the data never includes it).
 */
export function OrdersTable({
  rows,
  showPayment,
  linkOrders,
}: {
  rows: WeekRow[];
  showPayment: boolean;
  linkOrders: boolean;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "families" | "schools">("all");
  const [flagged, setFlagged] = useState(false);
  const [day, setDay] = useState("all");
  const days = useMemo(() => [...new Map(rows.map((r) => [r.date, r.dateLabel])).entries()], [rows]);
  const shown = rows.filter((r) => {
    if (day !== "all" && r.date !== day) return false;
    if (kind === "families" && r.school) return false;
    if (kind === "schools" && !r.school) return false;
    if (flagged && !r.flags.length && !r.modified && !r.conflict) return false;
    if (!q) return true;
    const hay = [r.orderNumber, r.customer, r.destination, ...r.children, ...r.items, r.notes ?? ""]
      .join(" ")
      .toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  const groups = new Map<string, Map<string, WeekRow[]>>();
  for (const r of shown) {
    const byDest = groups.get(r.date) ?? new Map<string, WeekRow[]>();
    byDest.set(r.destination, [...(byDest.get(r.destination) ?? []), r]);
    groups.set(r.date, byDest);
  }
  const chip = (on: boolean) =>
    cn(
      "min-h-11 rounded-full border-2 border-ink px-4 text-base font-bold",
      on ? "bg-orange shadow-ink-sm" : "bg-paper",
    );
  return (
    <section aria-labelledby="orders-h" className="space-y-4">
      <h2 id="orders-h" className="text-2xl font-black">
        Every order
      </h2>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="sr-only" htmlFor="orders-search">
          Search orders
        </label>
        <Input
          id="orders-search"
          type="search"
          placeholder="Search order #, family, child, school, meal…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-12 max-w-sm text-base"
        />
        <select
          aria-label="Delivery day"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="h-12 rounded-md border-2 border-ink bg-paper px-3 text-base"
        >
          <option value="all">All days</option>
          {days.map(([d, label]) => (
            <option key={d} value={d}>
              {label}
            </option>
          ))}
        </select>
        {(["all", "families", "schools"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            className={chip(kind === k)}
            onClick={() => setKind(k)}
          >
            {k === "all" ? "Everyone" : k === "families" ? "Families" : "Schools"}
          </button>
        ))}
        <button type="button" aria-pressed={flagged} className={chip(flagged)} onClick={() => setFlagged((v) => !v)}>
          Allergy flags only
        </button>
      </div>
      <p className="text-sm text-muted-foreground print:hidden" aria-live="polite">
        {shown.length} of {rows.length} order stops
      </p>
      {[...groups.entries()].map(([date, byDest]) => (
        <div key={date} className="space-y-3">
          <h3 className="sticky top-0 z-10 border-b-4 border-ink bg-background py-2 text-2xl font-black">
            {rows.find((r) => r.date === date)?.dateLabel}
          </h3>
          {[...byDest.entries()].map(([dest, list]) => (
            <div key={dest} className="overflow-x-auto rounded-2xl border-2 border-ink bg-paper">
              <h4 className="border-b-2 border-ink px-4 py-2 text-lg font-bold">{dest}</h4>
              <table className="w-full min-w-[44rem] text-left text-base">
                <thead>
                  <tr className="border-b border-ink/30 text-sm uppercase">
                    <th className="px-4 py-2">Order</th>
                    <th className="px-2 py-2">Customer</th>
                    <th className="px-2 py-2">Children</th>
                    <th className="px-2 py-2">Meals</th>
                    <th className="px-2 py-2">Allergy flags</th>
                    {showPayment ? <th className="px-2 py-2">Payment</th> : null}
                    <th className="px-2 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.key} className={cn("border-b border-ink/10 align-top", r.conflict && "bg-allergy/10")}>
                      <td className="px-4 py-2 font-bold whitespace-nowrap">
                        {linkOrders ? (
                          <Link href={`/admin/orders/${r.orderId}`} className="underline">
                            {r.orderNumber}
                          </Link>
                        ) : (
                          r.orderNumber
                        )}
                      </td>
                      <td className="px-2 py-2">{r.customer}</td>
                      <td className="px-2 py-2">{r.children.join(", ") || "—"}</td>
                      <td className="px-2 py-2">
                        <ul>
                          {r.items.map((i, n) => (
                            <li key={n}>{i}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-2 py-2">
                        {r.conflict ? (
                          <p className="flex items-center gap-1 font-black text-allergy">
                            <AlertTriangle aria-hidden="true" className="size-4" /> Needs attention
                          </p>
                        ) : null}
                        <ul className="flex flex-wrap gap-1">
                          {r.flags.map((f) => (
                            <li
                              key={f.name}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border-2 border-allergy px-2 text-sm font-bold",
                                f.severity === "severe" ? "bg-allergy text-allergy-foreground" : "text-allergy",
                              )}
                            >
                              {f.severity === "severe" ? <ShieldAlert aria-hidden="true" className="size-3.5" /> : null}
                              {f.name}
                            </li>
                          ))}
                        </ul>
                        {!r.flags.length && r.modified ? (
                          <span className="font-bold text-allergy">Allergy-safe meals</span>
                        ) : null}
                      </td>
                      {showPayment ? <td className="px-2 py-2 whitespace-nowrap">{r.payment}</td> : null}
                      <td className="px-2 py-2 text-sm">{r.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
      {shown.length === 0 ? <p className="text-lg text-muted-foreground">No orders match.</p> : null}
    </section>
  );
}
