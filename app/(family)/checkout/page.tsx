import Link from "next/link";

import { CheckoutFlow, PaymentPanel } from "@/components/family/checkout-flow";
import { PageTitle } from "@/components/family/kit";
import { RichText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import {
  getAddresses,
  getAllowance,
  getCart,
  getChildren,
  getHousehold,
  getOrder,
  getOrderableWeeks,
  getSubscription,
  getUsedElsewhere,
  getZoneForZip,
  toPlanAllowance,
} from "@/lib/family/queries";
import { publicEnv } from "@/lib/env.public";
import { normalizeLines } from "@/lib/ordering/logic";
import { stripeMockMode } from "@/lib/stripe/server";
import { formatDay } from "@/lib/time";

export const metadata = { title: "Checkout" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  await requireUser("/checkout");
  const sp = await searchParams;
  const [c, household, weeks] = await Promise.all([getContent(), getHousehold(), getOrderableWeeks()]);
  const copy = c.group("checkout.");
  if (!household) return null;

  // Step 4 (payment) renders from the placed order, so a refresh never loses it. RLS: own orders only.
  if (typeof sp.order === "string" && UUID.test(sp.order)) {
    const order = await getOrder(sp.order);
    if (order) {
      const lines = order.items
        .filter((i) => i.child_id && i.menu_item_id && i.delivery_date)
        .map((i) => ({
          childId: i.child_id!,
          menuItemId: i.menu_item_id!,
          deliveryDate: i.delivery_date!,
          quantity: i.quantity,
        }));
      return (
        <div className="mx-auto w-full max-w-2xl">
          <PageTitle>{copy.title}</PageTitle>
          <PaymentPanel
            copy={copy}
            placed={{
              orderId: order.id,
              orderNumber: order.order_number,
              dueCents: Math.max(order.total_cents - (order.amount_paid_cents - order.amount_refunded_cents), 0),
              status: order.status,
            }}
            lines={normalizeLines(lines)}
            replacing={false}
            testMode={stripeMockMode()}
            returnUrl={new URL(`/checkout?order=${order.id}`, publicEnv.NEXT_PUBLIC_SITE_URL).toString()}
            redirected={sp.redirect_status === "succeeded" || sp.redirect_status === "processing"}
          />
        </div>
      );
    }
  }

  // The requested week, else the first open week that has a cart.
  let week = weeks.find((w) => typeof sp.week === "string" && UUID.test(sp.week) && w.id === sp.week);
  let cart = week ? await getCart(household.id, week.id) : null;
  if (!week) {
    for (const w of weeks) {
      const candidate = await getCart(household.id, w.id);
      if (candidate.lines.length) {
        week = w;
        cart = candidate;
        break;
      }
    }
  }

  if (!week || !cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto w-full max-w-xl text-center">
        <PageTitle>{copy.title}</PageTitle>
        <p className="text-lg">{copy.empty}</p>
        <Button asChild size="lg" className="mt-4">
          <Link href="/order">{copy.back_to_menu}</Link>
        </Button>
      </div>
    );
  }

  const [kids, addresses, sub] = await Promise.all([
    getChildren(household.id),
    getAddresses(household.id),
    getSubscription(household.id),
  ]);
  const allowance = sub ? await getAllowance(sub.id, week.id) : null;
  const plan = toPlanAllowance(sub, allowance?.skipped ?? false);
  const usedElsewhere = await getUsedElsewhere(household.id, week.id, plan, cart.replacesOrderId);
  const zones = await Promise.all(addresses.map((a) => getZoneForZip(a.zip)));

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageTitle sub={formatDay(week.week_start, { month: "long", day: "numeric" })}>{copy.title}</PageTitle>
      <CheckoutFlow
        copy={copy}
        week={{ id: week.id, label: week.week_start }}
        lines={cart.lines}
        meals={week.meals.map((m) => ({ id: m.id, name: m.name, price_cents: m.price_cents, is_snack: m.is_snack }))}
        kids={kids.map((k) => ({ id: k.id, first_name: k.first_name, allergies: k.allergies, school_id: k.school_id }))}
        addresses={addresses.map((a, i) => ({
          id: a.id,
          label: [a.line1, a.line2, a.city, a.zip].filter(Boolean).join(", "),
          zone: zones[i] ? { ...zones[i]!, name: zones[i]!.name } : null,
          is_default: a.is_default,
        }))}
        plan={plan}
        usedElsewhere={usedElsewhere}
        disclaimer={<RichText doc={c.rich("checkout.allergy_disclaimer")} />}
      />
    </div>
  );
}
