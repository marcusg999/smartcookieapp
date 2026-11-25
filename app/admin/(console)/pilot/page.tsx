import { CheckCircle2, CircleAlert } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatInZone } from "@/lib/time";

import { CopyCode, HouseholdPilotToggle, InviteForm, PilotModeToggle, ResolveButton, TargetsForm } from "./pilot-tools";

export const metadata = { title: "Pilot" };

type Metrics = {
  families: number;
  onboarded: number;
  first_order: number;
  repeat_order: number;
  week2_eligible: number;
  week2_reordered: number;
  median_first_seconds: number | null;
  median_repeat_seconds: number | null;
  funnel: { started: number; placed: number; allergy_confirmed: number; paid: number };
  allergy_conflicts_caught: number;
  feedback_avg_rating: number | null;
  feedback_open: number;
};
type Targets = {
  reorder_week2_pct: number;
  median_repeat_seconds: number;
  max_allergy_incidents: number;
  allergy_incidents_recorded: number;
};

const card = "rounded-2xl border-2 border-ink bg-paper p-5";
const secs = (s: number | null) => (s == null ? "—" : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);

/**
 * Phase 10 pilot program: invite 3–5 founding families, watch the funnel and
 * feedback, and check the owner's success criteria before launching to all.
 */
export default async function PilotPage() {
  await requireStaffAAL2(["owner"]);
  const supabase = await createClient();
  const [{ data: settings }, { data: metricsRaw }, { data: invites }, { data: households }, { data: feedback }] =
    await Promise.all([
      supabase.from("site_settings").select("pilot_mode, pilot_targets, timezone").eq("id", true).single(),
      supabase.rpc("pilot_metrics"),
      supabase
        .from("pilot_invites")
        .select("id, code, email, note, used_by, used_at, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("households")
        .select("id, name, onboarded_at, created_at, household_members ( user_id ), orders ( id, status, created_at )")
        .eq("is_pilot", true)
        .is("closed_at", null),
      supabase
        .from("feedback")
        .select("id, kind, rating, comment, page_path, created_at, resolved_at, households ( name )")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
  const tz = (settings?.timezone as string | undefined) ?? "America/Los_Angeles";
  const m = (metricsRaw ?? {}) as Metrics;
  const targets = settings?.pilot_targets as Targets;
  const when = (iso: string | null) => (iso ? formatInZone(iso, tz, { month: "short", day: "numeric" }) : "—");
  type HH = {
    id: string;
    name: string;
    onboarded_at: string | null;
    household_members: { user_id: string }[];
    orders: { id: string; status: string; created_at: string }[];
  };
  const hhs = (households ?? []) as unknown as HH[];
  const byUser = new Map(hhs.flatMap((h) => h.household_members.map((mm) => [mm.user_id, h] as const)));
  const paidOrders = (h: HH) =>
    h.orders.filter((o) => ["paid", "invoiced", "fulfilled", "partially_refunded"].includes(o.status));

  const reorderPct = pct(m.week2_reordered ?? 0, m.week2_eligible ?? 0);
  const criteria = [
    {
      label: `At least ${targets.reorder_week2_pct}% of pilot families reorder in week 2`,
      value:
        reorderPct == null ? "Not enough data yet" : `${reorderPct}% (${m.week2_reordered} of ${m.week2_eligible})`,
      met: reorderPct != null && reorderPct >= targets.reorder_week2_pct,
      pending: reorderPct == null,
    },
    {
      label: `Median repeat order under ${secs(targets.median_repeat_seconds)}`,
      value: m.median_repeat_seconds == null ? "Not enough data yet" : secs(m.median_repeat_seconds),
      met: m.median_repeat_seconds != null && m.median_repeat_seconds < targets.median_repeat_seconds,
      pending: m.median_repeat_seconds == null,
    },
    {
      label: `No more than ${targets.max_allergy_incidents} allergy incidents`,
      value: `${targets.allergy_incidents_recorded} recorded · ${m.allergy_conflicts_caught ?? 0} conflicts caught before cooking`,
      met: targets.allergy_incidents_recorded <= targets.max_allergy_incidents,
      pending: false,
    },
  ];
  const f = m.funnel ?? { started: 0, placed: 0, allergy_confirmed: 0, paid: 0 };
  const steps = [
    { label: "Started an order (cart)", n: f.started },
    { label: "Placed it (went to checkout)", n: f.placed },
    { label: "Confirmed allergies", n: f.allergy_confirmed },
    { label: "Paid", n: f.paid },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title="Pilot"
        description="Invite a few founding families, see how ordering goes for them, and launch to everyone once the pilot meets your targets."
      />

      <section className={card} aria-labelledby="criteria-h">
        <h2 id="criteria-h" className="mb-3 text-xl font-bold">
          Success criteria
        </h2>
        <ul className="space-y-2">
          {criteria.map((c) => (
            <li key={c.label} className="flex items-start gap-2">
              {c.met ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-green-700" />
              ) : (
                <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-orange-700" />
              )}
              <span>
                <span className="font-semibold">{c.label}</span>
                <span className="sr-only">
                  {c.met ? " (met)" : c.pending ? " (waiting for data)" : " (not met yet)"}
                </span>
                <span className="block text-sm text-muted-foreground">{c.value}</span>
              </span>
            </li>
          ))}
        </ul>
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">Change the targets</summary>
          <div className="mt-3">
            <TargetsForm targets={targets} />
          </div>
        </details>
      </section>

      <section className={card} aria-labelledby="funnel-h">
        <h2 id="funnel-h" className="mb-3 text-xl font-bold">
          Pilot families at a glance
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Signed up", m.families ?? 0],
            ["Finished setup", m.onboarded ?? 0],
            ["Ordered once", m.first_order ?? 0],
            ["Ordered again", m.repeat_order ?? 0],
            ["Median first order", secs(m.median_first_seconds)],
            ["Median repeat order", secs(m.median_repeat_seconds)],
            ["Average weekly rating", m.feedback_avg_rating == null ? "—" : `${m.feedback_avg_rating} / 5`],
            ["Open feedback", m.feedback_open ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border-2 border-ink bg-card p-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-black">{value}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-5 mb-2 font-bold">Where orders stop</h3>
        <ol className="space-y-1 text-sm">
          {steps.map((s, i) => {
            const prev = i ? steps[i - 1]!.n : s.n;
            const drop = i && prev ? Math.round((100 * (prev - s.n)) / prev) : 0;
            return (
              <li key={s.label} className="flex justify-between gap-3 border-b border-ink/20 py-1">
                <span>
                  {i + 1}. {s.label}
                </span>
                <span className="font-semibold">
                  {s.n}
                  {i > 0 && drop > 0 ? <span className="ml-2 text-orange-800">−{drop}%</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          Counted on our own server from orders and carts. No tracking scripts or cookies.
        </p>
      </section>

      <section className={card} aria-labelledby="invite-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="invite-h" className="text-xl font-bold">
            Invite founding families
          </h2>
          <PilotModeToggle on={Boolean(settings?.pilot_mode)} />
        </div>
        <InviteForm />
        <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Invites">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-ink">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Sent to</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Set up</th>
                <th className="py-2">Orders</th>
              </tr>
            </thead>
            <tbody>
              {(invites ?? []).map((i) => {
                const h = i.used_by ? byUser.get(i.used_by as string) : undefined;
                return (
                  <tr key={i.id} className="border-b border-ink/20">
                    <td className="py-2 pr-3">
                      <CopyCode code={i.code as string} />
                      {i.note ? <span className="block text-xs text-muted-foreground">{i.note}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{(i.email as string | null) ?? "Anyone with the code"}</td>
                    <td className="py-2 pr-3">
                      {i.used_at ? `Signed up ${when(i.used_at as string)}` : "Not used yet"}
                    </td>
                    <td className="py-2 pr-3">{h ? (h.onboarded_at ? when(h.onboarded_at) : "Not yet") : "—"}</td>
                    <td className="py-2">{h ? paidOrders(h).length : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card} aria-labelledby="families-h">
        <h2 id="families-h" className="mb-3 text-xl font-bold">
          Pilot families
        </h2>
        {hhs.length ? (
          <ul className="divide-y divide-ink/20">
            {hhs.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <a href={`/admin/customers/${h.id}`} className="font-semibold underline underline-offset-4">
                    {h.name}
                  </a>
                  <span className="block text-sm text-muted-foreground">
                    {paidOrders(h).length} paid orders · set up {when(h.onboarded_at)}
                  </span>
                </span>
                <HouseholdPilotToggle householdId={h.id} pilot />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            No pilot families yet. Families who sign up with an invite code join automatically; you can also add an
            existing family from their customer page.
          </p>
        )}
      </section>

      <section className={card} aria-labelledby="feedback-h">
        <h2 id="feedback-h" className="mb-3 text-xl font-bold">
          Feedback
        </h2>
        {feedback?.length ? (
          <ul className="space-y-3">
            {feedback.map((fb) => (
              <li
                key={fb.id}
                className={`rounded-xl border-2 border-ink p-3 ${fb.resolved_at ? "bg-card" : "bg-orange-tint"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-bold">
                      {fb.kind === "weekly" ? `Weekly rating: ${fb.rating} / 5` : "Something confusing"}
                    </span>{" "}
                    · {(fb.households as unknown as { name: string } | null)?.name ?? "A pilot family"} ·{" "}
                    {when(fb.created_at as string)}
                    {fb.page_path ? <span className="block font-mono text-xs">on {fb.page_path}</span> : null}
                  </p>
                  <ResolveButton id={fb.id as string} resolved={Boolean(fb.resolved_at)} />
                </div>
                {fb.comment ? <p className="mt-2 whitespace-pre-wrap">{fb.comment}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No feedback yet.</p>
        )}
      </section>
    </div>
  );
}
