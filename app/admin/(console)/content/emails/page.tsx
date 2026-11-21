import Link from "next/link";

import { PageHeader, StatusPill } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Emails" };

export default async function EmailsPage() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (await createClient()).from("email_templates").select("key, subject, is_active, updated_at").order("key");
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="Emails" description="The emails customers receive (order confirmations, reminders, invoices). Edit the words; the design stays consistent." />
      <ul className="space-y-2">
        {(data ?? []).map((t) => (
          <li key={t.key}>
            <Link href={`/admin/content/emails/${t.key}`} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink bg-paper p-4 shadow-ink-sm hover:-translate-y-0.5">
              <span>
                <span className="block font-bold capitalize">{t.key.replace(/_/g, " ")}</span>
                <span className="text-sm text-muted-foreground">{t.subject}</span>
              </span>
              <StatusPill status={t.is_active ? "active" : "archived"} label={t.is_active ? "On" : "Off"} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
