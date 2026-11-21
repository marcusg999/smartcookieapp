import { notFound } from "next/navigation";

import { formatCents } from "@/lib/money";
import { PageHeader, StatusPill } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { formatInZone } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

import { CustomerTools } from "./customer-tools";

export const metadata = { title: "Customer" };

type Child = {
  id: string;
  first_name: string;
  last_initial: string | null;
  grade: string | null;
  dietary_preferences: string[];
  notes: string | null;
  archived_at: string | null;
  child_allergens: { severity: string; allergens: { name: string } | null }[];
};

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  await requireStaffAAL2(["ops", "owner"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: h } = await supabase
    .from("households")
    .select(
      "id, name, created_at, stripe_customer_id, household_members(role, user_id), addresses(id, line1, line2, city, zip, delivery_notes, is_default), children(id, first_name, last_initial, grade, dietary_preferences, notes, archived_at, child_allergens(severity, allergens(name)))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!h) notFound();
  const [{ data: orders }, { data: paid }, { data: subs }, { data: notes }, { data: credits }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, status, total_cents, placed_at, created_at")
      .eq("household_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Lifetime value counts every paid order, not just the 50 shown below.
    supabase
      .from("orders")
      .select("total_cents")
      .eq("household_id", id)
      .in("status", ["paid", "fulfilled", "invoiced", "partially_refunded"]),
    supabase
      .from("subscriptions")
      .select("id, status, quantity, current_period_end, plans(name)")
      .eq("household_id", id),
    supabase
      .from("customer_notes")
      .select("id, body, created_at")
      .eq("household_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("account_credits")
      .select("id, amount_cents, reason, created_at")
      .eq("household_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const members = (h.household_members ?? []) as { role: string; user_id: string }[];
  const { data: profiles } = members.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, phone")
        .in(
          "id",
          members.map((m) => m.user_id),
        )
    : { data: [] };
  const people = members.map((m) => ({ role: m.role, ...(profiles ?? []).find((p) => p.id === m.user_id) }));
  const ltv = (paid ?? []).reduce((sum, o) => sum + o.total_cents, 0);
  const balance = (credits ?? []).reduce((s, c) => s + c.amount_cents, 0);
  const children = ((h.children ?? []) as unknown as Child[]).filter((c) => !c.archived_at);
  const card = "rounded-2xl border-2 border-ink bg-paper p-5";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title={h.name}
        description={`Customer since ${formatInZone(h.created_at, "America/Los_Angeles", { dateStyle: "medium" })} · ${formatCents(ltv)} lifetime · ${formatCents(balance)} credit`}
      />
      <section className={card} aria-labelledby="kids">
        <h2 id="kids" className="mb-3 text-xl font-bold">
          Children
        </h2>
        {children.length === 0 ? (
          <p className="text-muted-foreground">No children added yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {children.map((c) => (
              <li key={c.id} className="rounded-xl border-2 border-ink/20 p-3">
                <p className="font-bold">
                  {c.first_name} {c.last_initial ? `${c.last_initial}.` : ""}{" "}
                  {c.grade ? <span className="font-normal text-muted-foreground">· {c.grade}</span> : null}
                </p>
                {c.child_allergens.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Allergies">
                    {c.child_allergens.map((a) => (
                      <li
                        key={a.allergens?.name}
                        className="rounded-full border-2 border-allergy bg-allergy px-2 py-0.5 text-xs font-bold text-white"
                      >
                        ⚠ {a.allergens?.name}
                        {a.severity === "severe" ? " (severe)" : a.severity === "intolerance" ? " (intolerance)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No allergies listed</p>
                )}
                {c.dietary_preferences.length ? (
                  <p className="mt-2 text-sm">Diet: {c.dietary_preferences.join(", ")}</p>
                ) : null}
                {c.notes ? <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <section className={card} aria-labelledby="people">
          <h2 id="people" className="mb-3 text-xl font-bold">
            Adults
          </h2>
          <ul className="space-y-1">
            {people.map((m, i) => (
              <li key={i}>
                {m.full_name ?? "Unnamed"}{" "}
                <span className="text-sm text-muted-foreground">
                  · {m.role}
                  {m.phone ? ` · ${m.phone}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 mb-1 font-bold">Addresses</h3>
          <ul className="space-y-1 text-sm">
            {(h.addresses ?? []).map(
              (a: {
                id: string;
                line1: string;
                line2: string | null;
                city: string;
                zip: string;
                delivery_notes: string | null;
                is_default: boolean;
              }) => (
                <li key={a.id}>
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}, {a.city} {a.zip}
                  {a.is_default ? " (default)" : ""}
                  {a.delivery_notes ? <span className="block text-muted-foreground">{a.delivery_notes}</span> : null}
                </li>
              ),
            )}
          </ul>
        </section>
        <section className={card} aria-labelledby="subs">
          <h2 id="subs" className="mb-3 text-xl font-bold">
            Subscription
          </h2>
          {(subs ?? []).length === 0 ? (
            <p className="text-muted-foreground">Orders à la carte.</p>
          ) : (
            <ul className="space-y-2">
              {(subs ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <StatusPill status={s.status === "active" ? "active" : "draft"} label={s.status.replace("_", " ")} />
                  {(s.plans as unknown as { name: string } | null)?.name} × {s.quantity}
                  {s.current_period_end ? (
                    <span className="text-sm text-muted-foreground">
                      renews {formatInZone(s.current_period_end, "America/Los_Angeles", { dateStyle: "medium" })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className={card} aria-labelledby="orders">
        <h2 id="orders" className="mb-3 text-xl font-bold">
          Orders
        </h2>
        {(orders ?? []).length === 0 ? (
          <p className="text-muted-foreground">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th className="py-2">Order</th>
                  <th>Placed</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(orders ?? []).map((o) => (
                  <tr key={o.id} className="border-b border-ink/10">
                    <td className="py-2 font-mono">{o.order_number}</td>
                    <td>{formatInZone(o.placed_at ?? o.created_at, "America/Los_Angeles", { dateStyle: "medium" })}</td>
                    <td>
                      <StatusPill status={o.status} label={o.status.replace("_", " ")} />
                    </td>
                    <td className="text-right">{formatCents(o.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CustomerTools householdId={h.id} notes={notes ?? []} credits={credits ?? []} />
    </div>
  );
}
