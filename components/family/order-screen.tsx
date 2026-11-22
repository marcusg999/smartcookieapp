"use client";

import {
  Bookmark,
  ChevronUp,
  Heart,
  Loader2,
  Minus,
  PauseCircle,
  Plus,
  Repeat2,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  applySavedOrder,
  clearCart,
  deleteSavedOrder,
  fillWithFavorites,
  repeatLastWeek,
  saveCart,
  saveNamedOrder,
  setWeekSkip,
  toggleFavorite,
} from "@/app/(family)/actions";
import { MealImage } from "@/components/menu/meal-image";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import {
  blockingAllergens,
  lineKey,
  priceCart,
  setLineQuantity,
  warningAllergens,
  type CartLine,
  type ChildAllergy,
  type PlanAllowance,
} from "@/lib/ordering/logic";
import { formatDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { AllergyChips, fmt, type Copy } from "./kit";

export type OrderMeal = {
  id: string;
  name: string;
  short_description: string | null;
  price_cents: number;
  is_snack: boolean;
  category: string | null;
  badges: string[];
  contains: string[];
  may_contain: string[];
  image: { path: string; alt: string } | null;
};

export type OrderChild = { id: string; first_name: string; allergies: ChildAllergy[]; overrides: string[] };

type Props = {
  copy: Copy;
  labels: { contains: string; mayContain: string; noAllergens: string };
  week: { id: string; week_start: string; delivery_dates: string[]; cutoff: string };
  meals: OrderMeal[];
  kids: OrderChild[];
  initialLines: CartLine[];
  editing: { id: string; number: string } | null;
  existingOrder: { id: string; number: string } | null;
  plan: PlanAllowance | null;
  usedElsewhere: { meals: Record<string, number>; snacks: Record<string, number> };
  subscription: { id: string; canSkip: boolean; skipped: boolean } | null;
  favorites: { childId: string | null; menuItemId: string }[];
  savedOrders: { id: string; name: string }[];
  autoRepeat?: boolean;
};

export function OrderScreen(props: Props) {
  const { copy, labels, week, meals, kids, plan, subscription } = props;
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>(props.initialLines);
  const [childId, setChildId] = useState(kids[0]?.id ?? "");
  const days = useMemo(() => [...week.delivery_dates].sort(), [week.delivery_dates]);
  const [day, setDay] = useState(days[0] ?? "");
  const [category, setCategory] = useState<string | null>(null);
  const [favorites, setFavorites] = useState(props.favorites);
  const [swapped, setSwapped] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState(false);
  const [busy, startBusy] = useTransition();
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(lines);

  const child = kids.find((k) => k.id === childId) ?? kids[0];
  const mealById = useMemo(() => new Map(meals.map((m) => [m.id, m])), [meals]);
  const priceMap = useMemo(
    () => Object.fromEntries(meals.map((m) => [m.id, { priceCents: m.price_cents, isSnack: m.is_snack }])),
    [meals],
  );
  const totals = useMemo(
    () => priceCart({ lines, meals: priceMap, plan, usedElsewhere: props.usedElsewhere }),
    [lines, priceMap, plan, props.usedElsewhere],
  );
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const categories = useMemo(
    () => [
      ...new Set(
        meals
          .filter((m) => !m.is_snack)
          .map((m) => m.category)
          .filter((c): c is string => Boolean(c)),
      ),
    ],
    [meals],
  );
  const mains = meals.filter((m) => !m.is_snack && (!category || m.category === category));
  const snacks = meals.filter((m) => m.is_snack);

  // Debounced server save of the cart (the server re-checks allergies too).
  const persist = (next: CartLine[]) => {
    latest.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      const res = await saveCart({ weekId: week.id, lines: latest.current });
      setSaving(false);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (res.data?.blocked.length) {
        toast.error(fmt(copy.blocked_toast, { reason: res.data.blocked.join("; ") }));
        setLines(res.data.lines);
      }
    }, 500);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /** Save any pending edit now (before leaving for checkout). */
  const flush = async () => {
    if (!saveTimer.current) return true;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const res = await saveCart({ weekId: week.id, lines: latest.current });
    setSaving(false);
    if (!res.ok) toast.error(res.message);
    return res.ok;
  };

  const update = (next: CartLine[]) => {
    setLines(next);
    persist(next);
  };

  const qtyFor = (mealId: string, c = childId, d = day) =>
    lines.find((l) => l.childId === c && l.menuItemId === mealId && l.deliveryDate === d)?.quantity ?? 0;

  const change = (meal: OrderMeal, delta: number) => {
    if (!child) return;
    const blocked = blockingAllergens(child, { id: meal.id, contains: meal.contains, mayContain: meal.may_contain });
    if (blocked.length && delta > 0) return; // Blocked assignments never reach the cart (CLAUDE.md §6).
    update(
      setLineQuantity(lines, { childId: child.id, menuItemId: meal.id, deliveryDate: day }, qtyFor(meal.id) + delta),
    );
  };

  const isFav = (mealId: string) =>
    favorites.some((f) => f.menuItemId === mealId && (f.childId === childId || f.childId === null));

  const toggleFav = (meal: OrderMeal) => {
    const existing = favorites.find((f) => f.menuItemId === meal.id && f.childId === childId);
    setFavorites(existing ? favorites.filter((f) => f !== existing) : [...favorites, { childId, menuItemId: meal.id }]);
    startBusy(async () => {
      const res = await toggleFavorite({ menuItemId: meal.id, childId });
      if (!res.ok) toast.error(res.message);
    });
  };

  const repeat = () =>
    startBusy(async () => {
      const res = await repeatLastWeek({ weekId: week.id });
      if (!res.ok) return void toast.error(res.message);
      if (!res.data || res.data.lines.length === 0) return void toast(copy.repeat_none);
      setLines(res.data.lines);
      latest.current = res.data.lines;
      setSwapped(
        Object.fromEntries(
          res.data.swaps.map((s) => [
            lineKey({ childId: s.childId, menuItemId: s.toId, deliveryDate: s.deliveryDate }),
            s.fromName,
          ]),
        ),
      );
      for (const d of res.data.dropped) {
        toast.error(
          fmt(copy.dropped, { name: kids.find((k) => k.id === d.childId)?.first_name ?? "", item: d.fromName }),
        );
      }
      toast.success(copy.repeat_done);
      setDrawer(true);
    });

  const fill = () =>
    startBusy(async () => {
      const res = await fillWithFavorites({ weekId: week.id, lines });
      if (!res.ok) return void toast.error(res.message);
      if (!res.data?.added) return void toast(copy.fill_none);
      setLines(res.data.lines);
      latest.current = res.data.lines;
      toast.success(copy.fill_done);
    });

  const skip = (value: boolean) =>
    startBusy(async () => {
      const res = await setWeekSkip({ subscriptionId: subscription!.id, weekId: week.id, skip: value });
      if (!res.ok) return void toast.error(res.message);
      router.refresh();
    });

  // "Repeat last week" from the account home: run it once on arrival.
  const autoRan = useRef(false);
  useEffect(() => {
    if (props.autoRepeat && !autoRan.current && lines.length === 0) {
      autoRan.current = true;
      repeat();
      router.replace(`/order?week=${week.id}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allowanceKey = plan?.unit === "per_child" ? childId : "household";
  const used = totals.mealsUsed[allowanceKey] ?? 0;
  const willBeIncluded = (meal: OrderMeal) => {
    if (!plan || plan.skipped) return false;
    const share = meal.is_snack ? totals.snackShare : totals.mealShare;
    const u = (meal.is_snack ? totals.snacksUsed : totals.mealsUsed)[allowanceKey] ?? 0;
    return u < share;
  };

  if (!child) return null;

  return (
    <div className="pb-40 md:pb-28">
      {/* Banners */}
      {props.editing ? (
        <p role="status" className="mb-4 rounded-xl border-2 border-ink bg-orange-tint px-4 py-2 font-semibold">
          {fmt(copy.editing, { number: props.editing.number })}
        </p>
      ) : props.existingOrder ? (
        <p
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-ink bg-paper px-4 py-2 font-semibold"
        >
          {fmt(copy.already_ordered, { number: props.existingOrder.number })}
          <Link
            href={`/orders/${props.existingOrder.id}`}
            className="underline decoration-orange decoration-[3px] underline-offset-4"
          >
            {copy.edit_order}
          </Link>
        </p>
      ) : null}
      {subscription?.skipped ? (
        <p role="status" className="mb-4 rounded-xl border-2 border-dashed border-ink bg-paper px-4 py-2 font-semibold">
          {copy.skipped}
        </p>
      ) : null}

      {/* Quick actions: one tap each */}
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        <Button onClick={repeat} disabled={busy} size="lg" className="shrink-0">
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Repeat2 aria-hidden="true" />}
          {copy.repeat}
        </Button>
        <Button onClick={fill} disabled={busy} variant="outline" size="lg" className="shrink-0">
          <Sparkles aria-hidden="true" /> {copy.fill_favorites}
        </Button>
        {subscription?.canSkip ? (
          <Button
            onClick={() => skip(!subscription.skipped)}
            disabled={busy}
            variant="outline"
            size="lg"
            className="shrink-0"
          >
            <PauseCircle aria-hidden="true" /> {subscription.skipped ? copy.unskip_week : copy.skip_week}
          </Button>
        ) : null}
        {props.savedOrders.length ? (
          <a
            href="#saved-orders"
            className="inline-flex h-13 shrink-0 items-center gap-2 rounded-lg border-2 border-ink bg-card px-5 font-semibold shadow-ink-sm"
          >
            <Bookmark aria-hidden="true" className="size-4" /> {copy.saved_orders}
          </a>
        ) : null}
      </div>

      {/* Child tabs */}
      <div
        role="tablist"
        aria-label={copy.kids_label}
        className="sticky top-14 z-20 -mx-4 flex gap-2 overflow-x-auto border-b-2 border-ink bg-background/95 px-4 py-2 backdrop-blur"
      >
        {kids.map((k) => {
          const n = lines.filter((l) => l.childId === k.id).reduce((s, l) => s + l.quantity, 0);
          const active = k.id === childId;
          return (
            <button
              key={k.id}
              role="tab"
              aria-selected={active}
              onClick={() => setChildId(k.id)}
              className={cn(
                "flex min-h-14 shrink-0 flex-col items-start gap-1 rounded-xl border-2 border-ink px-3 py-1.5 text-left transition-transform active:scale-95",
                active ? "bg-orange shadow-ink-sm" : "bg-paper",
              )}
            >
              <span className="flex items-center gap-2 font-bold">
                {k.first_name}
                {n ? <span className="rounded-full bg-ink px-1.5 text-xs text-paper">{n}</span> : null}
              </span>
              <AllergyChips allergies={k.allergies} size="xs" />
            </button>
          );
        })}
      </div>

      {/* Allowance meter */}
      {plan && !plan.skipped ? (
        <div className="mt-4 rounded-xl border-2 border-ink bg-paper p-3">
          <p className="text-sm font-bold">
            {fmt(plan.unit === "per_child" ? copy.allowance : copy.allowance_household, {
              used,
              total: totals.mealShare,
            })}
          </p>
          <div className="mt-2 h-3 overflow-hidden rounded-full border-2 border-ink bg-background" aria-hidden="true">
            <div
              className="h-full bg-orange transition-[width] duration-300"
              style={{ width: `${Math.min(100, (used / Math.max(totals.mealShare, 1)) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{copy.extra_note}</p>
        </div>
      ) : null}

      {/* Day picker */}
      <div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={copy.day_label}>
        {days.map((d) => {
          const n = lines
            .filter((l) => l.childId === childId && l.deliveryDate === d)
            .reduce((s, l) => s + l.quantity, 0);
          return (
            <button
              key={d}
              role="radio"
              aria-checked={d === day}
              onClick={() => setDay(d)}
              className={cn(
                "relative min-h-11 rounded-full border-2 border-ink px-4 font-bold transition-transform active:scale-95",
                d === day ? "bg-ink text-paper" : "bg-paper",
              )}
            >
              {formatDay(d, { weekday: "short", day: "numeric" })}
              {n ? (
                <span className="absolute -top-2 -right-1 grid size-5 place-items-center rounded-full border-2 border-ink bg-orange text-[0.65rem] text-ink">
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Category filter */}
      {categories.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {[null, ...categories].map((cat) => (
            <button
              key={cat ?? "all"}
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
              className={cn(
                "rounded-full border-2 px-3 py-1 text-sm font-semibold",
                category === cat ? "border-ink bg-orange-tint" : "border-ink/30 bg-paper",
              )}
            >
              {cat ?? copy.all_categories}
            </button>
          ))}
        </div>
      ) : null}

      {renderGrid(mains)}

      {snacks.length ? (
        <section aria-labelledby="snacks-h" className="mt-10">
          <h2 id="snacks-h" className="text-3xl font-black">
            {copy.snacks_title}
          </h2>
          <p className="text-muted-foreground">{copy.snacks_body}</p>
          {renderGrid(snacks, true)}
        </section>
      ) : null}

      {/* Saved orders */}
      <section
        id="saved-orders"
        aria-labelledby="saved-h"
        className="mt-12 rounded-2xl border-2 border-ink bg-paper p-5 shadow-ink"
      >
        <h2 id="saved-h" className="text-2xl font-black">
          {copy.saved_orders}
        </h2>
        {props.savedOrders.length ? (
          <ul className="mt-3 divide-y-2 divide-ink/10">
            {props.savedOrders.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <span className="font-semibold">{s.name}</span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      startBusy(async () => {
                        const res = await applySavedOrder({ id: s.id, weekId: week.id, lines });
                        if (!res.ok) return void toast.error(res.message);
                        setLines(res.data!.lines);
                        latest.current = res.data!.lines;
                        setDrawer(true);
                      })
                    }
                  >
                    {copy.apply}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`${copy.delete}: ${s.name}`}
                    onClick={() =>
                      startBusy(async () => {
                        const res = await deleteSavedOrder({ id: s.id });
                        if (!res.ok) toast.error(res.message);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {lines.length ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              startBusy(async () => {
                const res = await saveNamedOrder({ name: saveName, lines });
                if (!res.ok) return void toast.error(res.message);
                setSaveName("");
                toast.success(copy.save);
                router.refresh();
              });
            }}
          >
            <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
              {copy.save_name}
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                maxLength={80}
                required
                className="h-11 rounded-md border-2 border-ink bg-background px-3 font-normal"
              />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              <Bookmark aria-hidden="true" /> {copy.save}
            </Button>
          </form>
        ) : null}
      </section>

      {/* Cart bar + drawer (persistent on mobile, above the tab bar) */}
      <div className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 px-3 md:bottom-4">
        <div className="mx-auto max-w-3xl rounded-2xl border-2 border-ink bg-paper shadow-ink-lg">
          {drawer && lines.length ? (
            <div className="max-h-[45vh] overflow-y-auto border-b-2 border-ink p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-bold">{copy.view_cart}</p>
                <button onClick={() => setDrawer(false)} className="rounded-md p-1" aria-label={copy.view_cart}>
                  <X aria-hidden="true" className="size-5" />
                </button>
              </div>
              {kids.map((k) => {
                const mine = totals.lines
                  .filter((l) => l.childId === k.id)
                  .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
                if (!mine.length) return null;
                return (
                  <div key={k.id} className="mb-3">
                    <p className="text-sm font-black uppercase">{k.first_name}</p>
                    <ul className="mt-1 space-y-1">
                      {mine.map((l) => {
                        const key = lineKey(l);
                        return (
                          <li
                            key={key}
                            className={cn(
                              "flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm",
                              swapped[key] && "bg-orange-tint ring-2 ring-ink",
                            )}
                          >
                            <span>
                              <span className="font-semibold">{formatDay(l.deliveryDate, { weekday: "short" })}</span> ·{" "}
                              {mealById.get(l.menuItemId)?.name} × {l.quantity}
                              {swapped[key] ? (
                                <span className="ml-1 text-xs font-bold">
                                  ({fmt(copy.swapped, { from: swapped[key]! })})
                                </span>
                              ) : null}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="font-semibold">
                                {l.coveredQty > 0 && l.paidQty === 0
                                  ? copy.included
                                  : formatCents(l.unitPriceCents * l.paidQty)}
                              </span>
                              <button
                                className="rounded p-1"
                                aria-label={`${copy.remove}: ${mealById.get(l.menuItemId)?.name}`}
                                onClick={() => update(setLineQuantity(lines, l, 0))}
                              >
                                <Trash2 aria-hidden="true" className="size-4" />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              <button
                className="text-sm font-semibold underline"
                onClick={() =>
                  startBusy(async () => {
                    setLines([]);
                    latest.current = [];
                    await clearCart({ weekId: week.id });
                  })
                }
              >
                {copy.clear}
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-3 p-2 pl-4">
            <button
              onClick={() => setDrawer((d) => !d)}
              disabled={!lines.length}
              aria-expanded={drawer}
              className="flex flex-1 items-center gap-2 text-left"
            >
              <ChevronUp aria-hidden="true" className={cn("size-5 transition-transform", drawer && "rotate-180")} />
              <span>
                <span className="block text-sm font-bold" aria-live="polite">
                  {count === 1 ? copy.cart_item_one : count ? fmt(copy.cart_items, { count }) : copy.cart_empty}
                </span>
                <span className="block text-lg leading-tight font-black">
                  {copy.subtotal} {formatCents(totals.subtotalCents)}
                  {saving ? <Loader2 aria-hidden="true" className="ml-2 inline size-3 animate-spin" /> : null}
                </span>
              </span>
            </button>
            <Button asChild size="lg" className={cn(!lines.length && "pointer-events-none opacity-50")}>
              <Link
                href={`/checkout?week=${week.id}`}
                aria-disabled={!lines.length}
                tabIndex={lines.length ? 0 : -1}
                onClick={async (e) => {
                  if (!saveTimer.current) return;
                  e.preventDefault();
                  if (await flush()) router.push(`/checkout?week=${week.id}`);
                }}
              >
                {copy.checkout}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  function renderGrid(list: OrderMeal[], compact = false) {
    return (
      <ul className={cn("mt-5 grid gap-4", compact ? "grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {list.map((meal, i) => {
          const blocked = blockingAllergens(child!, {
            id: meal.id,
            contains: meal.contains,
            mayContain: meal.may_contain,
          });
          const warn = warningAllergens(child!, { contains: meal.contains, mayContain: meal.may_contain });
          const overridden = child!.overrides.includes(meal.id) && meal.contains.length > 0;
          const qty = qtyFor(meal.id);
          const included = willBeIncluded(meal);
          return (
            <li
              key={meal.id}
              style={{ "--tilt": `${[-0.8, 0.6, -0.4][i % 3]}deg` } as React.CSSProperties}
              className={cn(
                "reveal-up flex flex-col overflow-hidden rounded-2xl border-2 bg-paper transition-[transform,box-shadow] duration-200",
                blocked.length
                  ? "border-allergy/60 opacity-80"
                  : "border-ink shadow-ink hover:-translate-y-0.5 hover:shadow-ink-lg",
                qty > 0 && "ring-4 ring-orange",
              )}
            >
              <div className="relative">
                <MealImage
                  path={meal.image?.path}
                  alt=""
                  className={cn(compact ? "aspect-[4/3]" : "aspect-[16/10]", "border-b-2 border-ink")}
                  sizes="(min-width: 768px) 320px, 100vw"
                />
                <button
                  onClick={() => toggleFav(meal)}
                  aria-pressed={isFav(meal.id)}
                  aria-label={`${isFav(meal.id) ? copy.unfavorite : copy.favorite}: ${meal.name}`}
                  className="absolute top-2 right-2 grid size-11 place-items-center rounded-full border-2 border-ink bg-paper shadow-ink-sm transition-transform active:scale-90"
                >
                  <Heart
                    aria-hidden="true"
                    className={cn(
                      "size-5",
                      isFav(meal.id) && "animate-[pop_.3s_ease-out] fill-raspberry text-raspberry",
                    )}
                  />
                </button>
                {included && !blocked.length ? (
                  <span className="absolute bottom-2 left-2 rounded-full border-2 border-ink bg-orange px-2 py-0.5 text-xs font-black">
                    {copy.included}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className={cn("leading-tight font-bold", compact ? "text-base" : "text-xl")}>{meal.name}</h3>
                  <span className="shrink-0 font-bold">{formatCents(meal.price_cents)}</span>
                </div>
                {!compact && meal.short_description ? (
                  <p className="text-sm leading-snug">{meal.short_description}</p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {meal.badges.map((b) => (
                    <span key={b} className="rounded-full border border-ink bg-orange-tint px-2 text-xs font-semibold">
                      {b}
                    </span>
                  ))}
                </div>
                <p className="flex flex-wrap items-center gap-1 text-xs font-bold text-allergy">
                  {meal.contains.length ? (
                    <>
                      <ShieldAlert aria-hidden="true" className="size-3.5" />
                      {labels.contains}: {meal.contains.join(", ")}
                    </>
                  ) : (
                    <span className="font-semibold text-muted-foreground">{labels.noAllergens}</span>
                  )}
                  {meal.may_contain.length ? (
                    <span className="font-semibold">
                      · {labels.mayContain}: {meal.may_contain.join(", ")}
                    </span>
                  ) : null}
                </p>
                <div className="mt-auto pt-1">
                  {blocked.length ? (
                    <div role="note" className="rounded-lg border-2 border-allergy bg-paper p-2 text-sm text-allergy">
                      <p className="font-black">{fmt(copy.unavailable, { name: child!.first_name })}</p>
                      <p>{fmt(copy.unavailable_reason, { allergens: blocked.join(", "), name: child!.first_name })}</p>
                    </div>
                  ) : qty > 0 ? (
                    <div className="flex items-center justify-between rounded-lg border-2 border-ink bg-orange-tint p-1">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => change(meal, -1)}
                        aria-label={`${copy.remove}: ${meal.name}`}
                      >
                        <Minus aria-hidden="true" />
                      </Button>
                      <span className="font-black" aria-live="polite">
                        {qty}
                      </span>
                      <Button size="icon" onClick={() => change(meal, 1)} aria-label={`${copy.add}: ${meal.name}`}>
                        <Plus aria-hidden="true" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => change(meal, 1)}
                      aria-label={`${fmt(copy.add_for, { name: child!.first_name })}: ${meal.name}`}
                    >
                      <Plus aria-hidden="true" /> {fmt(copy.add_for, { name: child!.first_name })}
                    </Button>
                  )}
                  {overridden ? (
                    <p className="mt-1 text-xs font-semibold">{fmt(copy.override, { name: child!.first_name })}</p>
                  ) : null}
                  {warn.length && !blocked.length ? (
                    <p className="mt-1 text-xs font-semibold text-allergy">
                      {fmt(copy.warning, { allergens: warn.join(", ") })}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
}
