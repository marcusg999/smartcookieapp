import { CalendarClock, Truck } from "lucide-react";
import Link from "next/link";

import { Countdown, fmt } from "@/components/family/kit";
import { OrderScreen } from "@/components/family/order-screen";
import { RichText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getPublicSettings } from "@/lib/content/settings";
import {
  getAllowance,
  getCart,
  getChildren,
  getFavorites,
  getHousehold,
  getOrderableWeeks,
  getSavedOrders,
  getSubscription,
  getUsedElsewhere,
  getWeekOrder,
  toPlanAllowance,
} from "@/lib/family/queries";
import { getPublishedWeeks } from "@/lib/menu/queries";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatInZone, isPast } from "@/lib/time";

export const metadata = { title: "Order" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function OrderPage({ searchParams }: PageProps<"/order">) {
  await requireUser("/order");
  const sp = await searchParams;
  const [c, settings, household, weeks, published] = await Promise.all([
    getContent(),
    getPublicSettings().catch(() => null),
    getHousehold(),
    getOrderableWeeks(),
    getPublishedWeeks().catch(() => []),
  ]);
  const tz = settings?.timezone ?? "America/Los_Angeles";
  const copy = c.group("order.");

  if (!household) return null;
  const kids = await getChildren(household.id);

  if (settings && !settings.ordering_enabled) {
    return <Notice>{settings.ordering_paused_message || copy.paused}</Notice>;
  }
  if (kids.length === 0) {
    return (
      <Notice>
        <p>{copy.no_kids}</p>
        <Button asChild size="lg" className="mt-4">
          <Link href="/children">{copy.add_kids_cta}</Link>
        </Button>
      </Notice>
    );
  }
  if (weeks.length === 0) return <Notice>{copy.no_week}</Notice>;

  const week = weeks.find((w) => typeof sp.week === "string" && UUID.test(sp.week) && w.id === sp.week) ?? weeks[0]!;
  // A published week whose cutoff has passed is locked; say so above the next one.
  const passed = published.some((w) => isPast(w.cutoff) && w.week_start < week.week_start);

  const [cart, sub, favorites, savedOrders] = await Promise.all([
    getCart(household.id, week.id),
    getSubscription(household.id),
    getFavorites(household.id),
    getSavedOrders(household.id),
  ]);
  const allowance = sub ? await getAllowance(sub.id, week.id) : null;
  const skipped = allowance?.skipped ?? false;
  const plan = toPlanAllowance(sub, skipped);

  const supabase = await createClient();
  let editing: { id: string; number: string } | null = null;
  if (cart.replacesOrderId) {
    const { data } = await supabase.from("orders").select("id, order_number").eq("id", cart.replacesOrderId).maybeSingle();
    if (data) editing = { id: data.id, number: data.order_number };
  }
  const existing = editing ? null : await getWeekOrder(household.id, week.id);

  const usedElsewhere = await getUsedElsewhere(household.id, week.id, plan, editing?.id);

  const days = [...week.delivery_dates].sort();
  const daysLabel = days.map((d) => formatDay(d, { weekday: "short" })).join(", ");
  const cutoffLabel = formatInZone(week.cutoff!, tz, { weekday: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div className="mx-auto w-full max-w-5xl">
      {passed ? (
        <p role="status" className="mb-4 rounded-xl border-2 border-ink bg-orange-tint px-4 py-2 font-semibold">
          {copy.closed}
        </p>
      ) : null}
      <header className="mb-5">
        <h1 className="text-4xl leading-[0.95] font-black md:text-6xl">
          {fmt(copy.title, { date: formatDay(week.week_start, { month: "long", day: "numeric" }) })}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-3 py-1">
            <Truck aria-hidden="true" className="size-4" /> {fmt(copy.delivery_days, { days: daysLabel })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-orange px-3 py-1 shadow-ink-sm">
            <CalendarClock aria-hidden="true" className="size-4" /> {fmt(copy.cutoff, { date: cutoffLabel })}
          </span>
          <span className="inline-flex items-center rounded-full border-2 border-dashed border-ink px-3 py-1">
            <Countdown cutoff={week.cutoff!} template={copy.countdown} closedLabel={copy.closed} />
          </span>
        </div>
        {weeks.length > 1 ? (
          <nav aria-label={copy.day_label} className="mt-3 flex flex-wrap gap-2">
            {weeks.map((w) => (
              <Link
                key={w.id}
                href={`/order?week=${w.id}`}
                aria-current={w.id === week.id ? "page" : undefined}
                className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold ${w.id === week.id ? "bg-ink text-paper" : "bg-paper"}`}
              >
                {formatDay(w.week_start, { month: "short", day: "numeric" })}
              </Link>
            ))}
          </nav>
        ) : null}
        {week.notes_to_families ? <p className="mt-3 max-w-2xl">{week.notes_to_families}</p> : null}
      </header>

      <OrderScreen
        key={week.id}
        copy={copy}
        labels={{
          contains: c.text("menu.contains_label"),
          mayContain: c.text("menu.may_contain_label"),
          noAllergens: c.text("menu.no_allergens_label"),
        }}
        week={{ id: week.id, week_start: week.week_start, delivery_dates: week.delivery_dates, cutoff: week.cutoff! }}
        meals={week.meals
          .filter((m) => m.available_for !== "schools")
          .map((m) => ({
            id: m.id,
            name: m.name,
            short_description: m.short_description,
            price_cents: m.price_cents,
            is_snack: m.is_snack,
            category: m.category,
            badges: m.badges,
            contains: m.contains,
            may_contain: m.may_contain,
            image: m.image,
          }))}
        kids={kids.map((k) => ({ id: k.id, first_name: k.first_name, allergies: k.allergies, overrides: k.overrides }))}
        initialLines={cart.lines}
        editing={editing}
        existingOrder={existing ? { id: existing.id, number: existing.order_number } : null}
        plan={plan}
        usedElsewhere={usedElsewhere}
        subscription={sub && ["active", "trialing"].includes(sub.status) ? { id: sub.id, canSkip: sub.plan.allow_skip, skipped } : null}
        favorites={favorites.map((f) => ({ childId: f.childId, menuItemId: f.menuItemId }))}
        savedOrders={savedOrders.map((s) => ({ id: s.id, name: s.name }))}
        autoRepeat={sp.repeat === "1"}
      />

      <RichText doc={c.rich("menu.allergen_disclaimer")} className="mt-10 rounded-xl border-2 border-ink bg-paper p-4 text-sm" />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-10 w-full max-w-xl rounded-2xl border-2 border-ink bg-paper p-8 text-center text-lg shadow-ink-lg">
      {children}
    </div>
  );
}
