import { ExternalLink, FileText } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle, Panel } from "@/components/family/kit";
import { StatusTag } from "@/components/school/kit";
import { getContent } from "@/lib/content/content";
import { formatCents } from "@/lib/money";
import { invoiceState } from "@/lib/school/billing";
import { getInvoices, getSchoolContext, getSpend } from "@/lib/school/queries";
import { formatDay, todayInZone } from "@/lib/time";

export const metadata = { title: "Billing" };

export default async function SchoolBillingPage() {
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  if (!ctx || ctx.role !== "school_admin") notFound();
  const [invoices, spend] = await Promise.all([getInvoices(ctx.school.id), getSpend(ctx.school.id)]);
  const today = todayInZone("America/Los_Angeles");
  const outstanding = invoices
    .filter((i) => i.status === "open")
    .reduce((s, i) => s + i.total_cents - i.amount_paid_cents, 0);
  const day = (d: string | null) => (d ? formatDay(d, { month: "short", day: "numeric", year: "numeric" }) : "");
  const months = [...new Set(spend.map((s) => s.month))];
  return (
    <div className="space-y-6">
      <PageTitle sub={c.text("school.billing.subtitle")}>{c.text("school.billing.title")}</PageTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-sm font-semibold">{c.text("school.billing.outstanding")}</p>
          <p className="text-3xl font-black">{formatCents(outstanding)}</p>
        </Panel>
        <Panel>
          <p className="text-sm font-semibold">{c.text("school.billing.terms")}</p>
          <p className="text-3xl font-black">
            {c.text("school.billing.net", { days: String(ctx.school.billing_terms_days) })}
          </p>
        </Panel>
        <Panel>
          <p className="text-sm font-semibold">{c.text("school.billing.pay_with")}</p>
          <p className="text-lg font-bold">{c.text("school.billing.methods")}</p>
        </Panel>
      </div>

      <Panel>
        <h2 className="mb-3 text-xl font-bold">{c.text("school.billing.invoices")}</h2>
        {invoices.length === 0 ? (
          <p className="text-muted-foreground">{c.text("school.billing.no_invoices")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th className="py-2">{c.text("school.billing.col_invoice")}</th>
                  <th>{c.text("school.billing.col_period")}</th>
                  <th>{c.text("school.billing.col_due")}</th>
                  <th>{c.text("school.billing.col_status")}</th>
                  <th className="text-right">{c.text("school.billing.col_total")}</th>
                  <th className="text-right">
                    <span className="sr-only">{c.text("school.billing.col_actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const state = invoiceState(i, today);
                  return (
                    <tr key={i.id} className="border-b border-ink/10">
                      <td className="py-2 font-semibold">{i.number ?? "—"}</td>
                      <td>
                        {day(i.period_start)} – {day(i.period_end)}
                      </td>
                      <td>{day(i.due_date)}</td>
                      <td>
                        <StatusTag
                          tone={
                            state === "paid" ? "ok" : state === "overdue" ? "bad" : state === "open" ? "warn" : "muted"
                          }
                        >
                          {c.text(`school.billing.status_${state}`)}
                        </StatusTag>
                      </td>
                      <td className="text-right font-semibold">{formatCents(i.total_cents)}</td>
                      <td className="space-x-2 text-right whitespace-nowrap">
                        {i.pdf_url ? (
                          <a
                            href={i.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-semibold underline"
                          >
                            <FileText aria-hidden="true" className="size-4" /> {c.text("school.billing.pdf")}
                          </a>
                        ) : null}
                        {(state === "open" || state === "overdue") && i.hosted_invoice_url ? (
                          <a
                            href={i.hosted_invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-orange px-2 py-1 font-bold shadow-ink-sm"
                          >
                            {c.text("school.billing.pay_now")} <ExternalLink aria-hidden="true" className="size-3" />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="mb-3 text-xl font-bold">{c.text("school.billing.spend")}</h2>
        {months.length === 0 ? (
          <p className="text-muted-foreground">{c.text("school.billing.no_spend")}</p>
        ) : (
          <div className="space-y-4">
            {months.map((m) => {
              const rows = spend.filter((s) => s.month === m);
              return (
                <div key={m}>
                  <h3 className="font-bold">
                    {formatDay(m, { month: "long", year: "numeric" })} ·{" "}
                    {formatCents(rows.reduce((s, r) => s + Number(r.amount_cents), 0))}
                  </h3>
                  <ul className="text-sm">
                    {rows.map((r) => (
                      <li key={r.group_label} className="flex justify-between border-b border-ink/10 py-1">
                        <span>
                          {r.group_label} · {c.text("school.billing.meals", { count: String(r.meals) })}
                        </span>
                        <span>{formatCents(Number(r.amount_cents))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
