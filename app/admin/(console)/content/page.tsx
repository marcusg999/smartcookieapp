import { Eye } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { CONTENT_GROUPS } from "@/lib/content/registry";
import { createClient } from "@/lib/supabase/server";

import { SiteTextEditor, type BlockState } from "./site-text-editor";

export const metadata = { title: "Site text" };

export default async function SiteTextPage({ searchParams }: PageProps<"/admin/content">) {
  await requireStaffAAL2(["owner"]);
  const params = await searchParams;
  const group = CONTENT_GROUPS.find((g) => g.id === params.group) ?? CONTENT_GROUPS[0]!;
  const supabase = await createClient();
  const keys = group.items.map((i) => i.key);
  const { data: blocks } = await supabase
    .from("content_blocks")
    .select("id, key, draft_value, published_value, published_at")
    .in("key", keys);
  const ids = (blocks ?? []).map((b) => b.id);
  const { data: versions } = ids.length
    ? await supabase
        .from("content_versions")
        .select("id, block_id, value, created_at")
        .in("block_id", ids)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };

  const state: Record<string, BlockState> = {};
  for (const item of group.items) {
    const b = (blocks ?? []).find((x) => x.key === item.key);
    state[item.key] = {
      draft: b?.draft_value ?? b?.published_value ?? null,
      published: b?.published_value ?? null,
      publishedAt: b?.published_at ?? null,
      versions: (versions ?? [])
        .filter((v) => v.block_id === b?.id)
        .slice(0, 8)
        .map((v) => ({ id: v.id, value: v.value, created_at: v.created_at })),
    };
  }
  const pendingAll = (blocks ?? []).filter(
    (b) => JSON.stringify(b.draft_value) !== JSON.stringify(b.published_value) && b.draft_value !== null,
  ).length;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Site text"
        description="Every word customers see. Edit, save a draft, preview it on the real page, then publish. Old versions are kept so you can undo."
        actions={
          <Button asChild variant="outline">
            <a
              href={`/api/preview?path=${group.id === "menu" ? "/menu" : group.id === "account" ? "/account" : "/"}`}
              target="_blank"
              rel="noreferrer"
            >
              <Eye aria-hidden="true" /> Preview drafts
            </a>
          </Button>
        }
      />
      <nav aria-label="Site sections" className="mb-6 flex flex-wrap gap-2">
        {CONTENT_GROUPS.map((g) => (
          <a
            key={g.id}
            href={`/admin/content?group=${g.id}`}
            aria-current={g.id === group.id ? "page" : undefined}
            className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-bold ${g.id === group.id ? "bg-orange shadow-ink-sm" : "bg-paper"}`}
          >
            {g.label}
          </a>
        ))}
      </nav>
      <SiteTextEditor group={group} blocks={state} pendingTotal={pendingAll} />
    </div>
  );
}
