"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChipToggle, Field } from "@/components/admin/fields";
import { useStepUp } from "@/components/mfa/step-up";
import { StandingOrderForm, type StandingOrderInput } from "@/components/school/standing-order-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/auth/action-result";
import type { Copy } from "@/lib/content/fmt";
import { formatCents } from "@/lib/money";
import type { Classroom, Invoice, SchoolMenuItem, StandingOrder } from "@/lib/school/queries";

import {
  adminSaveStandingOrder,
  generateSchoolInvoice,
  markInvoicePaidOutOfBand,
  refreshSchoolOrders,
  retrySchoolInvoice,
  saveSchoolPricing,
} from "../actions";

const card = "space-y-4 rounded-2xl border-2 border-ink bg-paper p-5";

function useAdminRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, after?: (r: ActionResult<unknown>) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done.");
      else toast.error(r.message);
      after?.(r);
      router.refresh();
    });
  return { pending, run };
}

/** School price list switch (owner + step-up) and "re-plan open weeks". */
export function PricingAndPlanning({
  orgId,
  useSchoolPricing,
  isOwner,
}: {
  orgId: string;
  useSchoolPricing: boolean;
  isOwner: boolean;
}) {
  const runWithStepUp = useStepUp();
  const { pending, run } = useAdminRun();
  return (
    <section className={card} aria-labelledby="pricing">
      <h2 id="pricing" className="text-xl font-bold">
        Pricing & weekly orders
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <ChipToggle
          pressed={useSchoolPricing}
          onPressedChange={(v) => {
            if (isOwner && !pending)
              run(() => runWithStepUp(() => saveSchoolPricing({ id: orgId, use_school_pricing: v })));
          }}
        >
          {useSchoolPricing ? "School price list on" : "Standard menu prices"}
        </ChipToggle>
        {!isOwner ? <span className="text-sm text-muted-foreground">Only the owner can change pricing.</span> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Standing orders turn into weekly orders automatically once a week is published (hourly). Changes to classrooms,
        allergy counts, closures and standing orders re-plan open weeks straight away. Use this after editing a
        published menu week.
      </p>
      <Button variant="outline" disabled={pending} onClick={() => run(() => refreshSchoolOrders({ id: orgId }))}>
        <RefreshCw aria-hidden="true" /> Re-plan open weeks
      </Button>
    </section>
  );
}

export function AdminStandingOrders({
  orgId,
  copy,
  orders,
  classrooms,
  catalog,
  categories,
}: {
  orgId: string;
  copy: Copy;
  orders: StandingOrder[];
  classrooms: Classroom[];
  catalog: SchoolMenuItem[];
  categories: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const runWithStepUp = useStepUp();
  const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const save = (v: StandingOrderInput) =>
    runWithStepUp(() => adminSaveStandingOrder({ organization_id: orgId, order: v })).then((r) => {
      if (r.ok) setEditing(null);
      return r;
    });
  return (
    <section className={card} aria-labelledby="standing">
      <h2 id="standing" className="text-xl font-bold">
        Standing orders
      </h2>
      {orders.length === 0 ? <p className="text-muted-foreground">No standing orders yet.</p> : null}
      <ul className="space-y-3">
        {orders.map((so) => (
          <li key={so.id} className="rounded-xl border-2 border-ink/20 p-3">
            {editing === so.id ? (
              <StandingOrderForm
                copy={copy}
                initial={{ ...so, classroom_id: so.classroom_id ?? classrooms[0]?.id ?? "", notes: so.notes ?? "" }}
                classrooms={classrooms}
                catalog={catalog}
                categories={categories}
                save={save}
                afterSave={null}
                allowDelete={false}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{so.name}</span>{" "}
                  <span className="text-sm text-muted-foreground">
                    · {so.status} · {classrooms.find((c) => c.id === so.classroom_id)?.name ?? "no classroom"} ·{" "}
                    {so.weekdays.map((d) => DAYS[d]).join(", ")} ·{" "}
                    {so.quantity_mode === "fixed"
                      ? `${so.fixed_quantity} meals/day`
                      : `headcount + ${so.buffer_percent}%`}{" "}
                    · {so.menu_selection_mode.replace(/_/g, " ")}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(so.id)}
                  disabled={classrooms.length === 0}
                >
                  Adjust
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AdminInvoices({
  orgId,
  invoices,
  isOwner,
  today,
}: {
  orgId: string;
  invoices: Invoice[];
  isOwner: boolean;
  today: string;
}) {
  const runWithStepUp = useStepUp();
  const { pending, run } = useAdminRun();
  const [through, setThrough] = useState(today);
  const [paying, setPaying] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  return (
    <section className={card} aria-labelledby="invoices">
      <h2 id="invoices" className="text-xl font-bold">
        Invoices
      </h2>
      <div className="flex flex-wrap items-end gap-2">
        <Field id="through" label="Invoice everything delivered up to">
          <Input id="through" type="date" max={today} value={through} onChange={(e) => setThrough(e.target.value)} />
        </Field>
        <Button disabled={pending || !through} onClick={() => run(() => generateSchoolInvoice({ id: orgId, through }))}>
          Create invoice now
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Monthly invoices are created automatically on the invoice day (Settings → School billing). This creates a
        mid-month invoice for meals not billed yet.
      </p>
      {invoices.length === 0 ? (
        <p className="text-muted-foreground">No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-ink">
                <th className="py-2">Invoice</th>
                <th>Period</th>
                <th>Due</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const overdue = i.status === "open" && i.due_date && i.due_date < today;
                return (
                  <tr key={i.id} className="border-b border-ink/10 align-top">
                    <td className="py-2 font-semibold">
                      {i.number ?? "draft"}{" "}
                      <span className="text-xs text-muted-foreground">({i.kind.replace("_", "-")})</span>
                    </td>
                    <td>
                      {i.period_start} – {i.period_end}
                    </td>
                    <td>{i.due_date ?? "—"}</td>
                    <td>
                      <span className={overdue ? "font-bold text-allergy" : ""}>{overdue ? "overdue" : i.status}</span>
                      {i.paid_out_of_band ? (
                        <span className="block text-xs">check/PO {i.payment_reference}</span>
                      ) : null}
                    </td>
                    <td className="text-right">{formatCents(i.total_cents)}</td>
                    <td className="space-y-1 text-right">
                      {i.hosted_invoice_url ? (
                        <a
                          href={i.hosted_invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 underline"
                        >
                          View <ExternalLink aria-hidden="true" className="size-3" />
                        </a>
                      ) : null}
                      {i.status === "draft" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => retrySchoolInvoice({ invoice_id: i.id }))}
                        >
                          Retry
                        </Button>
                      ) : null}
                      {isOwner && (i.status === "open" || i.status === "uncollectible") ? (
                        paying === i.id ? (
                          <form
                            className="flex justify-end gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              run(
                                () => runWithStepUp(() => markInvoicePaidOutOfBand({ invoice_id: i.id, reference })),
                                (r) => r.ok && setPaying(null),
                              );
                            }}
                          >
                            <Input
                              aria-label="Check or PO number"
                              placeholder="Check / PO #"
                              className="h-8 w-32"
                              value={reference}
                              onChange={(e) => setReference(e.target.value)}
                            />
                            <Button size="xs" type="submit" disabled={pending || !reference.trim()}>
                              Mark paid
                            </Button>
                          </form>
                        ) : (
                          <Button size="xs" variant="outline" onClick={() => setPaying(i.id)}>
                            Paid by check/PO
                          </Button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
