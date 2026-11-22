import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, StatusPill } from "@/components/admin/page-header";
import { PAYMENT_STATUS_LABEL, paymentStatus } from "@/lib/admin/payment-status";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatInZone } from "@/lib/time";

import { RefundForm } from "./refund-form";

export const metadata = { title: "Order" };

export default async function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const user = await requireStaffAAL2(["ops", "owner"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: o }, { data: settings }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `id, order_number, status, source, fulfillment, subtotal_cents, delivery_fee_cents, discount_cents, tax_cents, credit_cents,
         total_cents, amount_paid_cents, amount_refunded_cents, payment_failed_at, last_payment_error, placed_at, created_at, notes,
         household_id, households ( name ), organizations ( name ),
         order_items ( id, item_name, quantity, unit_price_cents, delivery_date, covered_by_subscription, children ( first_name ) ),
         order_payments ( id, stripe_payment_intent_id, kind, amount_cents, status, refunded_cents, last_error, created_at ),
         order_refunds ( id, amount_cents, reason, status, stripe_refund_id, error, created_at )`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("site_settings").select("ops_refund_limit_cents").eq("id", true).single(),
  ]);
  if (!o) notFound();
  type Item = {
    id: string;
    item_name: string;
    quantity: number;
    unit_price_cents: number;
    delivery_date: string | null;
    covered_by_subscription: boolean;
    children: { first_name: string } | null;
  };
  type Pay = {
    id: string;
    stripe_payment_intent_id: string;
    kind: string;
    amount_cents: number;
    status: string;
    refunded_cents: number;
    last_error: string | null;
    created_at: string;
  };
  type Ref = {
    id: string;
    amount_cents: number;
    reason: string;
    status: string;
    stripe_refund_id: string | null;
    error: string | null;
    created_at: string;
  };
  const items = (o.order_items ?? []) as unknown as Item[];
  const payments = (o.order_payments ?? []) as unknown as Pay[];
  const refunds = (o.order_refunds ?? []) as unknown as Ref[];
  const pay = paymentStatus(o);
  const refundable = o.amount_paid_cents - o.amount_refunded_cents;
  const who =
    (o.households as unknown as { name: string } | null)?.name ??
    (o.organizations as unknown as { name: string } | null)?.name ??
    "Deleted account";
  const dashboard = (pi: string) => `https://dashboard.stripe.com/test/payments/${pi}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Link href="/admin/orders" className="text-sm font-semibold underline">
        ← Orders
      </Link>
      <PageHeader
        title={`Order ${o.order_number}`}
        description={`${who} · placed ${formatInZone(o.placed_at ?? o.created_at, "America/Los_Angeles", { dateStyle: "medium", timeStyle: "short" })}`}
      />
      <div className="flex flex-wrap gap-2">
        <StatusPill status={o.status} label={o.status.replace("_", " ")} />
        <span className="rounded-full border-2 border-ink bg-orange-tint px-2.5 py-0.5 text-xs font-bold">
          {PAYMENT_STATUS_LABEL[pay]}
        </span>
        {o.household_id ? (
          <Link href={`/admin/customers/${o.household_id}`} className="text-sm underline">
            Customer · notes & credits
          </Link>
        ) : null}
      </div>
      {o.last_payment_error ? (
        <p className="rounded-xl border-2 border-destructive p-3 text-sm font-semibold text-destructive">
          Last payment problem: {o.last_payment_error}
        </p>
      ) : null}

      <section className="rounded-2xl border-2 border-ink bg-paper p-4">
        <h2 className="mb-2 text-lg font-bold">Meals</h2>
        <ul className="divide-y divide-ink/10 text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-1.5">
              <span>
                {i.children?.first_name ?? "–"} · {i.delivery_date ? formatDay(i.delivery_date) : ""} · {i.item_name} ×{" "}
                {i.quantity}
              </span>
              <span className="font-semibold">
                {i.covered_by_subscription ? "Included" : formatCents(i.unit_price_cents * i.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid max-w-sm grid-cols-2 gap-x-4 text-sm">
          <dt>Meals</dt>
          <dd className="text-right">{formatCents(o.subtotal_cents)}</dd>
          <dt>Delivery</dt>
          <dd className="text-right">{formatCents(o.delivery_fee_cents)}</dd>
          {o.discount_cents ? (
            <>
              <dt>Discount</dt>
              <dd className="text-right">−{formatCents(o.discount_cents)}</dd>
            </>
          ) : null}
          {o.credit_cents ? (
            <>
              <dt>Account credit</dt>
              <dd className="text-right">−{formatCents(o.credit_cents)}</dd>
            </>
          ) : null}
          {o.tax_cents ? (
            <>
              <dt>Tax</dt>
              <dd className="text-right">{formatCents(o.tax_cents)}</dd>
            </>
          ) : null}
          <dt className="font-bold">Total</dt>
          <dd className="text-right font-bold">{formatCents(o.total_cents)}</dd>
          <dt>Collected</dt>
          <dd className="text-right">{formatCents(o.amount_paid_cents)}</dd>
          <dt>Refunded</dt>
          <dd className="text-right">{formatCents(o.amount_refunded_cents)}</dd>
        </dl>
      </section>

      <section className="rounded-2xl border-2 border-ink bg-paper p-4">
        <h2 className="mb-2 text-lg font-bold">Payments</h2>
        {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payment attempts yet.</p> : null}
        <ul className="space-y-1 text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {p.kind === "adjustment" ? "Change top-up" : "Payment"} · {formatCents(p.amount_cents)} ·{" "}
                <strong>{p.status.replace("_", " ")}</strong>
                {p.refunded_cents ? ` · refunded ${formatCents(p.refunded_cents)}` : ""}
                {p.last_error ? ` · ${p.last_error}` : ""}
              </span>
              {p.stripe_payment_intent_id.startsWith("pi_") && !p.stripe_payment_intent_id.includes("_mock_") ? (
                <a
                  className="font-mono text-xs underline"
                  href={dashboard(p.stripe_payment_intent_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {p.stripe_payment_intent_id}
                </a>
              ) : (
                <span className="font-mono text-xs">{p.stripe_payment_intent_id}</span>
              )}
            </li>
          ))}
        </ul>
        {refunds.length ? (
          <>
            <h3 className="mt-4 font-bold">Refunds</h3>
            <ul className="space-y-1 text-sm">
              {refunds.map((r) => (
                <li key={r.id}>
                  {formatCents(r.amount_cents)} · <strong>{r.status}</strong> · {r.reason}
                  {r.error ? ` · ${r.error}` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {refundable > 0 ? (
        <section className="rounded-2xl border-2 border-ink bg-paper p-4">
          <h2 className="mb-2 text-lg font-bold">Refund</h2>
          <RefundForm
            orderId={o.id}
            refundableCents={refundable}
            limitCents={user.roles.includes("owner") ? null : (settings?.ops_refund_limit_cents ?? 0)}
            lines={items
              .filter((i) => !i.covered_by_subscription && i.unit_price_cents > 0)
              .map((i) => ({
                id: i.id,
                label: `${i.children?.first_name ?? ""} · ${i.item_name} × ${i.quantity}`,
                paidCents: i.unit_price_cents * i.quantity,
              }))}
          />
        </section>
      ) : null}
      {o.notes ? <p className="text-sm whitespace-pre-line text-muted-foreground">{o.notes}</p> : null}
    </div>
  );
}
