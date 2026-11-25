"use client";

import { AlertTriangle, CalendarX, Check, RotateCcw } from "lucide-react";
import { useState } from "react";

import { cancelBulkOrder, changeDay, markWeekReviewed } from "@/app/(school)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import type { Classroom, OrderLine, SchoolMenuItem, SchoolOrder, StandingOrder } from "@/lib/school/queries";
import { formatDay } from "@/lib/time";

import { AllergenChips, Countdown, fmt, Panel, selectClass, StatusTag, useRun, type Copy } from "./kit";

type Adjustment = {
  standing_order_id: string;
  delivery_date: string;
  headcount: number | null;
  skip: boolean;
  items: string[] | null;
  note: string | null;
};

export function WeekOrders({
  copy,
  week,
  open,
  orders,
  standingOrders,
  classrooms,
  adjustments,
  items,
  closures,
  isAdmin,
}: {
  copy: Copy;
  week: { id: string; week_start: string; delivery_dates: string[]; cutoff: string };
  open: boolean;
  orders: SchoolOrder[];
  standingOrders: StandingOrder[];
  classrooms: Classroom[];
  adjustments: Adjustment[];
  items: SchoolMenuItem[];
  closures: { closure_date: string; reason: string | null }[];
  isAdmin: boolean;
}) {
  const { pending, run } = useRun(copy);
  const unreviewed = orders.some((o) => !o.school_reviewed_at);
  const standing = standingOrders.filter(
    (so) =>
      orders.some((o) => o.standing_order_id === so.id) ||
      (so.status === "active" &&
        so.start_date <= week.delivery_dates.at(-1)! &&
        (!so.end_date || so.end_date >= week.week_start)),
  );
  const bulk = orders.filter((o) => o.source === "school_bulk");

  return (
    <div className="space-y-6">
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {open ? (
              <Countdown cutoff={week.cutoff} template={copy["orders.cutoff_in"]} closedLabel={copy["orders.locked"]} />
            ) : (
              copy["orders.locked"]
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {open ? copy["orders.open_help"] : copy["orders.locked_help"]}
          </p>
        </div>
        {orders.length > 0 && unreviewed ? (
          <Button
            disabled={pending}
            onClick={() => run(() => markWeekReviewed({ menu_week_id: week.id }), copy["orders.reviewed"])}
          >
            <Check aria-hidden="true" /> {copy["orders.mark_reviewed"]}
          </Button>
        ) : orders.length > 0 ? (
          <StatusTag tone="ok">{copy["orders.reviewed_tag"]}</StatusTag>
        ) : null}
      </Panel>

      {standing.length === 0 && bulk.length === 0 ? (
        <p className="text-muted-foreground">{copy["orders.empty"]}</p>
      ) : null}

      {standing.map((so) => {
        const order = orders.find((o) => o.standing_order_id === so.id);
        const room = classrooms.find((c) => c.id === so.classroom_id);
        const days = week.delivery_dates.filter((d) => {
          const iso = new Date(`${d}T12:00:00Z`).getUTCDay() || 7;
          return so.weekdays.includes(iso) && d >= so.start_date && (!so.end_date || d <= so.end_date);
        });
        return (
          <Panel key={so.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold">{so.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {room?.name} · {order ? order.order_number : copy["orders.not_planned"]}
                </p>
              </div>
              {order ? <p className="text-lg font-black">{formatCents(order.total_cents)}</p> : null}
            </div>
            {order?.needs_review ? (
              <div role="alert" className="rounded-xl border-2 border-allergy bg-paper p-3 text-sm">
                <p className="flex items-center gap-2 font-bold text-allergy">
                  <AlertTriangle aria-hidden="true" className="size-4" /> {copy["orders.needs_review"]}
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {order.review_notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ul className="divide-y-2 divide-ink/10">
              {days.map((d) => (
                <DayRow
                  key={d}
                  copy={copy}
                  date={d}
                  so={so}
                  headcount={room?.headcount ?? 0}
                  lines={(order?.lines ?? []).filter((l) => l.delivery_date === d)}
                  adjustment={adjustments.find((a) => a.standing_order_id === so.id && a.delivery_date === d)}
                  closure={closures.find((c) => c.closure_date === d)}
                  items={items}
                  open={open}
                />
              ))}
            </ul>
          </Panel>
        );
      })}

      {bulk.map((o) => (
        <Panel key={o.id} className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold">
                {fmt(copy["orders.bulk_title"], { location: o.dropoff_location ?? "" })}
              </h2>
              <p className="text-sm text-muted-foreground">
                {o.order_number}
                {o.notes ? ` · ${o.notes}` : ""}
              </p>
            </div>
            <p className="text-lg font-black">{formatCents(o.total_cents)}</p>
          </div>
          <ul className="text-sm">
            {o.lines.map((l) => (
              <li key={l.id}>
                {formatDay(l.delivery_date)} · {l.item_name} × {l.quantity}
              </li>
            ))}
          </ul>
          {open && isAdmin ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                window.confirm(copy["orders.cancel_bulk_confirm"]) &&
                run(() => cancelBulkOrder({ id: o.id }), copy["orders.bulk_cancelled"])
              }
            >
              {copy["orders.cancel_bulk"]}
            </Button>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}

function DayRow({
  copy,
  date,
  so,
  headcount,
  lines,
  adjustment,
  closure,
  items,
  open,
}: {
  copy: Copy;
  date: string;
  so: StandingOrder;
  headcount: number;
  lines: OrderLine[];
  adjustment?: Adjustment;
  closure?: { reason: string | null };
  items: SchoolMenuItem[];
  open: boolean;
}) {
  const { pending, run } = useRun(copy);
  const [count, setCount] = useState<string>(
    String(adjustment?.headcount ?? (so.quantity_mode === "fixed" ? so.fixed_quantity : headcount) ?? ""),
  );
  const [swap, setSwap] = useState<string>(adjustment?.items?.[0] ?? "");
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const safe = lines.filter((l) => l.safe_for_allergens.length > 0).reduce((s, l) => s + l.quantity, 0);
  const base = { standing_order_id: so.id, delivery_date: date, note: "" };
  const label = formatDay(date, { weekday: "long", month: "short", day: "numeric" });
  const countLabel = so.quantity_mode === "fixed" ? copy["orders.meals_today"] : copy["orders.headcount_today"];

  if (closure) {
    return (
      <li className="flex items-center gap-2 py-3 text-muted-foreground">
        <CalendarX aria-hidden="true" className="size-4" />
        <span className="font-semibold">{label}</span> · {fmt(copy["orders.closed"], { reason: closure.reason ?? "" })}
      </li>
    );
  }
  if (adjustment?.skip) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-3">
        <span>
          <span className="font-semibold">{label}</span> ·{" "}
          <span className="text-muted-foreground">{copy["orders.skipped"]}</span>
        </span>
        {open ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => changeDay({ ...base, headcount: null, skip: false, items: null, clear: true }),
                copy["orders.restored"],
              )
            }
          >
            <RotateCcw aria-hidden="true" /> {copy["orders.restore"]}
          </Button>
        ) : null}
      </li>
    );
  }
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {label}
          {adjustment ? <span className="ml-2 text-xs font-bold text-raspberry">{copy["orders.changed"]}</span> : null}
        </p>
        <p className="text-sm text-muted-foreground">{fmt(copy["orders.day_summary"], { meals: total, safe })}</p>
      </div>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2">
            <span>
              {l.item_name} × <span className="font-bold">{l.quantity}</span>
            </span>
            {l.child ? (
              <span className="font-semibold">
                {fmt(copy["orders.for_child"], {
                  name: `${l.child.first_name}${l.child.last_initial ? ` ${l.child.last_initial}.` : ""}`,
                })}
              </span>
            ) : null}
            {l.safe_for_allergens.length ? (
              <AllergenChips names={l.safe_for_allergens.map((a) => fmt(copy["orders.safe_for"], { allergen: a }))} />
            ) : null}
          </li>
        ))}
      </ul>
      {open ? (
        <details className="rounded-xl border-2 border-ink/20 p-2">
          <summary className="cursor-pointer text-sm font-semibold">{copy["orders.change_day"]}</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-sm font-semibold" htmlFor={`hc-${so.id}-${date}`}>
              {countLabel}
              <Input
                id={`hc-${so.id}-${date}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="mt-1 w-28"
              />
            </label>
            <Button
              size="sm"
              disabled={pending || count === ""}
              onClick={() =>
                run(
                  () =>
                    changeDay({
                      ...base,
                      headcount: Number(count),
                      skip: false,
                      items: adjustment?.items ?? null,
                      clear: false,
                    }),
                  copy["orders.day_saved"],
                )
              }
            >
              {copy["orders.save_count"]}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 text-sm font-semibold" htmlFor={`swap-${so.id}-${date}`}>
              {copy["orders.swap"]}
              <select
                id={`swap-${so.id}-${date}`}
                className={`${selectClass} mt-1`}
                value={swap}
                onChange={(e) => setSwap(e.target.value)}
              >
                <option value="">{copy["orders.swap_none"]}</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.allergens.length ? `${i.name} (${i.allergens.join(", ")})` : i.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={pending || !swap}
              onClick={() =>
                run(
                  () =>
                    changeDay({
                      ...base,
                      headcount: adjustment?.headcount ?? null,
                      skip: false,
                      items: [swap],
                      clear: false,
                    }),
                  copy["orders.day_saved"],
                )
              }
            >
              {copy["orders.save_swap"]}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{copy["orders.swap_help"]}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => changeDay({ ...base, headcount: null, skip: true, items: null, clear: false }),
                  copy["orders.day_skipped"],
                )
              }
            >
              {copy["orders.skip"]}
            </Button>
            {adjustment ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(
                    () => changeDay({ ...base, headcount: null, skip: false, items: null, clear: true }),
                    copy["orders.restored"],
                  )
                }
              >
                <RotateCcw aria-hidden="true" /> {copy["orders.reset_day"]}
              </Button>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}
