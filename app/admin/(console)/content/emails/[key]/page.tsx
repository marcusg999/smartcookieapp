import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { allowedVariables, EMAIL_CATALOG } from "@/lib/email/catalog";
import { createClient } from "@/lib/supabase/server";
import { formatInZone } from "@/lib/time";
import type { RichNode } from "@/lib/validation/rich-text";

import { EmailEditor } from "./email-editor";

export const metadata = { title: "Edit email" };

const CATEGORY_LABEL = {
  transactional: "Account email: always sent (people can't turn it off)",
  security: "Security notice: always sent",
  marketing: "Optional: people can unsubscribe",
} as const;

export default async function EmailPage({ params }: PageProps<"/admin/content/emails/[key]">) {
  await requireStaffAAL2(["owner"]);
  const { key } = await params;
  const supabase = await createClient();
  const [{ data }, { data: log }, { data: settings }] = await Promise.all([
    supabase
      .from("email_templates")
      .select("key, subject, preheader, body_rich, cta_label, is_active")
      .eq("key", key)
      .maybeSingle(),
    // Recent sends of this email. Addresses are cleared once handled; the
    // log keeps a hash so support can match "did my email go out?".
    supabase
      .from("notifications_log")
      .select("id, status, recipient_hash, created_at, sent_at, error, attempts")
      .eq("template_key", key)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("site_settings").select("timezone").eq("id", true).single(),
  ]);
  if (!data) notFound();
  const entry = EMAIL_CATALOG[key];
  const tz = (settings?.timezone as string | undefined) ?? "America/Los_Angeles";
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title={entry?.label ?? data.key.replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase())}
        description="Use the variable buttons to insert details like the order number. The preview uses sample values."
      />
      {entry ? (
        <dl className="grid gap-2 rounded-2xl border-2 border-ink bg-paper p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-bold">Sent when</dt>
            <dd>{entry.when}</dd>
          </div>
          <div>
            <dt className="font-bold">Goes to</dt>
            <dd className="capitalize">{entry.audience === "owner" ? "You (the owner)" : entry.audience}</dd>
          </div>
          <div>
            <dt className="font-bold">Type</dt>
            <dd>{CATEGORY_LABEL[entry.category]}</dd>
          </div>
        </dl>
      ) : null}
      <EmailEditor
        template={{
          key: data.key,
          subject: data.subject,
          preheader: data.preheader ?? "",
          cta_label: (data.cta_label as string | null) ?? "",
          body: data.body_rich as RichNode,
          is_active: data.is_active,
        }}
        hasButton={Boolean(entry?.cta)}
        variables={[...allowedVariables(key)].map((name) => ({ name, label: name.replace(/_/g, " ") }))}
      />
      <section aria-labelledby="log-h" className="rounded-2xl border-2 border-ink bg-paper p-4">
        <h2 id="log-h" className="mb-3 font-display text-xl font-bold">
          Recently sent
        </h2>
        {log?.length ? (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recently sent emails">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th className="py-2 pr-3">Queued</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Recipient (hashed)</th>
                  <th className="py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-b border-ink/20">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatInZone(r.created_at as string, tz)}</td>
                    <td className="py-2 pr-3 capitalize">{r.status}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {(r.recipient_hash as string | null)?.slice(0, 12) ?? "—"}
                    </td>
                    <td className="py-2 text-xs">{r.error ?? (r.attempts ? `${r.attempts} attempt(s)` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground">Nothing sent yet.</p>
        )}
      </section>
    </div>
  );
}
