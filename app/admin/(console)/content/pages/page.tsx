import { Plus } from "lucide-react";
import Link from "next/link";

import { PageHeader, StatusPill } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pages" };

export default async function PagesList() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (await createClient()).from("pages").select("id, title, slug, is_published, updated_at").is("archived_at", null).order("title");
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Pages"
        description="About, policies and any other page. Each one gets its own link, like /about."
        actions={<Button asChild><Link href="/admin/content/pages/new"><Plus aria-hidden="true" /> New page</Link></Button>}
      />
      <ul className="space-y-2">
        {(data ?? []).map((p) => (
          <li key={p.id}>
            <Link href={`/admin/content/pages/${p.id}`} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink bg-paper p-4 shadow-ink-sm hover:-translate-y-0.5">
              <span>
                <span className="font-bold">{p.title}</span>
                <span className="ml-2 font-mono text-sm text-muted-foreground">/{p.slug}</span>
              </span>
              <StatusPill status={p.is_published ? "published" : "draft"} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
