import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/admin/page-header";
import { Input } from "@/components/ui/input";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { formatInZone } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Audit log" };
const PAGE = 50;

/** Owner-only, read-only view of the append-only audit log (CLAUDE.md §5.6). */
export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireStaffAAL2(["owner"]);
  const sp = await searchParams;
  const action = String(sp.action ?? "")
    .trim()
    .replace(/[^a-z0-9._-]/gi, "")
    .slice(0, 60);
  const entity = String(sp.entity ?? "")
    .trim()
    .replace(/[^a-z0-9_]/gi, "")
    .slice(0, 40);
  const before = Number(sp.before) || null;
  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select("id, occurred_at, actor_id, actor_roles, action, entity_type, entity_id, changes, before, after, ip")
    .order("id", { ascending: false })
    .limit(PAGE);
  if (action) q = q.ilike("action", `${action}%`);
  if (entity) q = q.eq("entity_type", entity);
  if (before) q = q.lt("id", before);
  const { data: rows } = await q;
  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const name = (id: string | null) =>
    id ? ((actors ?? []).find((a) => a.id === id)?.full_name ?? "Staff member") : "System";
  const qs = (extra: Record<string, string | number>) =>
    "?" +
    new URLSearchParams({
      ...(action && { action }),
      ...(entity && { entity }),
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
    }).toString();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Audit log"
        description="Every admin change, who made it and what changed. Nobody can edit or delete these entries."
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" role="search">
        <label>
          <span className="sr-only">Action starts with</span>
          <Input name="action" defaultValue={action} placeholder="Action, e.g. menu_item" />
        </label>
        <label>
          <span className="sr-only">Entity type</span>
          <Input name="entity" defaultValue={entity} placeholder="Entity, e.g. menu_items" />
        </label>
        <button className="h-11 rounded-md border-2 border-ink bg-orange px-4 font-bold shadow-ink-sm" type="submit">
          Filter
        </button>
      </form>
      {(rows ?? []).length === 0 ? (
        <EmptyState title="Nothing logged" body="Try clearing the filters." />
      ) : (
        <ol className="space-y-2">
          {(rows ?? []).map((r) => {
            const diff = (r.changes ?? null) as Record<string, { from?: unknown; to?: unknown }> | null;
            return (
              <li key={r.id} className="rounded-xl border-2 border-ink/20 bg-paper p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <code className="font-bold">{r.action}</code>
                    {r.entity_type ? (
                      <span className="text-sm text-muted-foreground">
                        {" "}
                        · {r.entity_type}
                        {r.entity_id ? ` ${String(r.entity_id).slice(0, 8)}` : ""}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatInZone(r.occurred_at, "America/Los_Angeles", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
                <p className="text-sm">
                  {name(r.actor_id)}
                  {r.actor_roles?.length ? ` (${r.actor_roles.join(", ")})` : ""}
                  {r.ip ? ` · ${r.ip}` : ""}
                </p>
                {diff && Object.keys(diff).length ? (
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer font-semibold">
                      What changed ({Object.keys(diff).length})
                    </summary>
                    <dl className="mt-2 grid gap-1">
                      {Object.entries(diff)
                        .slice(0, 30)
                        .map(([k, v]) => (
                          <div key={k} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                            <dt className="font-mono text-xs">{k}</dt>
                            <dd className="font-mono text-xs break-all">
                              <span className="line-through opacity-60">
                                {JSON.stringify(v?.from ?? null).slice(0, 200)}
                              </span>{" "}
                              → {JSON.stringify(v?.to ?? null).slice(0, 200)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {(rows ?? []).length === PAGE ? (
        <div className="mt-4">
          <Link className="font-semibold underline" href={`/admin/audit${qs({ before: rows![rows!.length - 1]!.id })}`}>
            Older entries →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
