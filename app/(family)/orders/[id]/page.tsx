import { ArrowLeft, MapPin, School, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AllergyChips, PageTitle } from "@/components/family/kit";
import { fmt } from "@/lib/content/fmt";
import { OrderActions } from "@/components/family/order-actions";
import { RichText } from "@/components/rich-text";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getPublicSettings } from "@/lib/content/settings";
import { getChildren, getHousehold, getOrder } from "@/lib/family/queries";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatInZone, isPast } from "@/lib/time";

export const metadata = { title: "Order" };

export default async function OrderDetailPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  await requireUser(`/orders/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c, settings, household, order] = await Promise.all([
    getContent(),
    getPublicSettings().catch(() => null),
    getHousehold(),
    getOrder(id),
  ]);
  if (!order || !household) notFound();
  const tz = settings?.timezone ?? "America/Los_Angeles";
  const kids = await getChildren(household.id);
  const supabase = await createClient();
  const { data: cutoff } = await supabase.rpc("menu_week_cutoff", { p_week: order.menu_week_id });
  const open = typeof cutoff === "string" && !isPast(cutoff);
  const canChange = open && ["pending_payment", "paid"].includes(order.status);
  const byChild = new Map<string, typeof order.items>();
  for (const item of order.items) {
    const key = item.child_id ?? "";
    byChild.set(key, [...(byChild.get(key) ?? []), item]);
  }
  const copy = c.group("orders.");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/orders" className="inline-flex items-center gap-1 font-semibold">
        <ArrowLeft aria-hidden="true" className="size-4" /> {c.text("orders.title")}
      </Link>
      <PageTitle sub={c.text(`orders.status_${order.status}`)}>{order.order_number}</PageTitle>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-paper p-4">
        <p className="text-sm font-semibold">
          {canChange && typeof cutoff === "string"
            ? fmt(copy.change_until, { date: formatInZone(cutoff, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })
            : copy.locked}
        </p>
        <OrderActions copy={copy} orderId={order.id} canChange={canChange} canPay={order.status === "pending_payment" && order.total_cents > 0} />
      </div>

      {[...byChild.entries()].map(([childId, items]) => {
        const kid = kids.find((k) => k.id === childId);
        return (
          <section key={childId} className="rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-black">{kid?.first_name ?? "–"}</h2>
              {kid ? <AllergyChips allergies={kid.allergies} size="xs" /> : null}
            </div>
            <ul className="mt-2 divide-y divide-ink/10">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{i.delivery_date ? formatDay(i.delivery_date) : ""}</span> · {i.item_name} × {i.quantity}
                    {i.allergens_contained.length ? (
                      <span className="block text-xs font-bold text-allergy">
                        {c.text("menu.contains_label")}: {i.allergens_contained.join(", ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-semibold">
                    {i.covered_by_subscription ? c.text("checkout.included") : formatCents(i.unit_price_cents * i.quantity, order.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <dl className="space-y-1 rounded-2xl border-2 border-ink bg-paper p-4 text-sm">
        {[
          [c.text("checkout.subtotal"), order.subtotal_cents],
          [c.text("checkout.delivery_fee"), order.delivery_fee_cents],
          ...(order.discount_cents ? [[c.text("checkout.discount"), -order.discount_cents] as const] : []),
          ...(order.tax_cents ? [[c.text("checkout.tax"), order.tax_cents] as const] : []),
        ].map(([label, cents]) => (
          <div key={String(label)} className="flex justify-between">
            <dt>{label}</dt>
            <dd className="font-semibold">{formatCents(Number(cents), order.currency)}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t-2 border-ink pt-2 text-lg font-black">
          <dt>{c.text("checkout.total")}</dt>
          <dd>{formatCents(order.total_cents, order.currency)}</dd>
        </div>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-ink bg-paper p-4 text-sm">
          {order.fulfillment === "school_dropoff" ? (
            <p className="flex items-center gap-2 font-bold">
              <School aria-hidden="true" className="size-4" /> {copy.school_dropoff}
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2 font-bold">
                <MapPin aria-hidden="true" className="size-4" /> {copy.delivery_to}
              </p>
              {order.address_snapshot ? (
                <p className="mt-1">
                  {[order.address_snapshot.line1, order.address_snapshot.line2, order.address_snapshot.city, order.address_snapshot.zip].filter(Boolean).join(", ")}
                </p>
              ) : null}
            </>
          )}
        </div>
        {order.allergy_confirmed_at ? (
          <p className="flex items-center gap-2 rounded-2xl border-2 border-ink bg-paper p-4 text-sm font-semibold">
            <ShieldCheck aria-hidden="true" className="size-4" />
            {fmt(copy.allergies_confirmed, { date: formatInZone(order.allergy_confirmed_at, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })}
          </p>
        ) : null}
      </div>

      {canChange ? (
        <details className="rounded-2xl border-2 border-dashed border-ink p-4 text-sm">
          <summary className="cursor-pointer font-semibold">{copy.refund_policy}</summary>
          <RichText doc={c.rich("orders.refund_policy_body")} className="mt-2" />
        </details>
      ) : null}
    </div>
  );
}
