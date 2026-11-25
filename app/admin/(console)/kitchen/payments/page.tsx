import Link from "next/link";

import { KitchenHeader } from "@/components/kitchen/kit";
import { ReminderButton } from "@/components/kitchen/toggles";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { getKitchenSettings, getKitchenWeeks, getWeekOpsOrders, pickKitchenWeek } from "@/lib/kitchen/data";
import { formatCents } from "@/lib/money";
import { invoiceState } from "@/lib/school/billing";
import { createClient } from "@/lib/supabase/server";
import { formatInZone, todayInZone } from "@/lib/time";

export const metadata = { title: "Who has paid" };

/** Who has paid (ops/owner): unpaid / failed family orders with reminders, and school invoices. */
export default async function PaymentsPage({ searchParams }: PageProps<"/admin/kitchen/payments">) {
  await requireStaffAAL2(["ops", "owner"]);
  const [weeks, settings] = await Promise.all([getKitchenWeeks(), getKitchenSettings()]);
  const sp = await searchParams;
  const today = todayInZone("America/Los_Angeles");
  const week = pickKitchenWeek(weeks, typeof sp.week === "string" ? sp.week : undefined, today);
  const orders = week ? await getWeekOpsOrders(week.id) : [];
  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, number, status, total_cents, amount_paid_cents, due_date, organization_id, organizations ( name )")
    .in("status", ["open", "uncollectible"])
    .order("due_date");
  const unpaid = orders.filter((o) => o.status === "pending_payment");
  const paid = orders.filter((o) => o.status !== "pending_payment" && o.household_name);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 text-lg">
      <KitchenHeader
        title="Who has paid"
        description={
          settings.exclude_unpaid
            ? "Unpaid à-la-carte orders are kept off the cook list after cutoff (Settings → Kitchen)."
            : "Unpaid à-la-carte orders are included in the cook list (Settings → Kitchen)."
        }
        weeks={weeks}
        week={week}
        path="/admin/kitchen/payments"
      />
      <section aria-labelledby="unpaid-h" className="rounded-2xl border-2 border-ink bg-paper p-5">
        <h2 id="unpaid-h" className="mb-3 text-2xl font-black">
          Unpaid family orders ({unpaid.length})
        </h2>
        {unpaid.length === 0 ? (
          <p>Everyone has paid.</p>
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {unpaid.map((o) => (
              <li key={o.order_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/admin/orders/${o.order_id}`} className="text-xl font-bold underline">
                    {o.order_number}
                  </Link>{" "}
                  · {o.household_name} · {formatCents(o.total_cents as number)}
                  {o.payment_failed_at ? (
                    <p className="text-base font-bold text-destructive">
                      Payment failed{o.last_payment_error ? `: ${String(o.last_payment_error)}` : ""}
                    </p>
                  ) : null}
                  {o.reminder_sent_at ? (
                    <p className="text-base text-muted-foreground">
                      Reminder sent {formatInZone(o.reminder_sent_at as string, "America/Los_Angeles")}
                    </p>
                  ) : null}
                </div>
                <ReminderButton orderId={o.order_id} sentAt={(o.reminder_sent_at as string | null) ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="paid-h" className="rounded-2xl border-2 border-ink bg-paper p-5">
        <h2 id="paid-h" className="mb-3 text-2xl font-black">
          Paid family orders ({paid.length})
        </h2>
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {paid.map((o) => (
            <li key={o.order_id} className="border-b border-ink/10 py-1 text-base">
              {o.order_number} · {o.household_name} · {formatCents(o.amount_paid_cents as number)}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="schools-h" className="rounded-2xl border-2 border-ink bg-paper p-5">
        <h2 id="schools-h" className="mb-3 text-2xl font-black">
          School invoices not yet paid
        </h2>
        {(invoices ?? []).length === 0 ? (
          <p>No open school invoices.</p>
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {(invoices ?? []).map((i) => {
              const state = invoiceState(i as { status: string; due_date: string | null }, today);
              return (
                <li key={i.id as string} className="flex flex-wrap justify-between gap-2 py-2">
                  <Link href={`/admin/schools/${i.organization_id}`} className="font-bold underline">
                    {(i.organizations as unknown as { name: string } | null)?.name ?? "School"}
                  </Link>
                  <span>
                    {i.number ?? "—"} · {formatCents((i.total_cents as number) - (i.amount_paid_cents as number))} · due{" "}
                    {i.due_date ?? "—"} ·{" "}
                    <span className={state === "overdue" ? "font-black text-allergy" : "font-bold"}>{state}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
