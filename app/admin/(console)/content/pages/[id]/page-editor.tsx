"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmButton } from "@/components/admin/confirm";
import { Field } from "@/components/admin/fields";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RichNode } from "@/lib/validation/rich-text";

import { savePage, unpublishPage } from "../../cms-actions";

type P = {
  id?: string;
  title: string;
  slug: string;
  seo_title: string;
  seo_description: string;
  og_image: string;
  body: RichNode | null;
  is_published: boolean;
};

export function PageEditor({ page }: { page: P }) {
  const router = useRouter();
  const [p, setP] = useState(page);
  const [saved, setSaved] = useState(JSON.stringify(page));
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => JSON.stringify(p) !== saved, [p, saved]);
  useUnsavedGuard(dirty);
  const set = <K extends keyof P>(k: K, v: P[K]) => setP((x) => ({ ...x, [k]: v }));

  async function save(publish: boolean) {
    setBusy(true);
    const r = await savePage({ ...p, body: p.body ?? { type: "doc", content: [] }, publish });
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(r.message);
    setSaved(JSON.stringify(p));
    const data = (r as { data?: { id: string; slug: string } }).data;
    if (data) set("slug", data.slug);
    if (!p.id && data) router.replace(`/admin/content/pages/${data.id}`);
    else router.refresh();
  }

  return (
    <div className="space-y-5 rounded-2xl border-2 border-ink bg-paper p-5">
      <Field id="pg-title" label="Page title">
        <Input id="pg-title" value={p.title} maxLength={120} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field id="pg-slug" label="Link" help="Letters, numbers and dashes. Leave empty to create it from the title.">
        <div className="flex items-center gap-1">
          <span className="font-mono text-muted-foreground">/</span>
          <Input id="pg-slug" value={p.slug} maxLength={80} onChange={(e) => set("slug", e.target.value)} />
        </div>
      </Field>
      <Field id="pg-body" label="Page content">
        <RichTextEditor id="pg-body" label="Page content" value={p.body} onChange={(d) => set("body", d)} />
      </Field>
      <details className="rounded-xl border-2 border-ink/40 p-3">
        <summary className="cursor-pointer font-semibold">Search engines & sharing</summary>
        <div className="mt-3 space-y-3">
          <Field id="pg-seo-t" label="Title in Google (max 70 characters)">
            <Input
              id="pg-seo-t"
              value={p.seo_title}
              maxLength={70}
              onChange={(e) => set("seo_title", e.target.value)}
            />
          </Field>
          <Field id="pg-seo-d" label="Description in Google (max 200 characters)">
            <textarea
              id="pg-seo-d"
              rows={2}
              maxLength={200}
              value={p.seo_description}
              onChange={(e) => set("seo_description", e.target.value)}
              className="w-full rounded-md border-2 border-ink bg-card px-3 py-2"
            />
          </Field>
          <Field id="pg-og" label="Sharing image" help="Copy a path from the Media library.">
            <Input id="pg-og" value={p.og_image} onChange={(e) => set("og_image", e.target.value)} />
          </Field>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || (!dirty && !!p.id)} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button disabled={busy} onClick={() => save(true)}>
          {p.is_published ? "Publish changes" : "Publish page"}
        </Button>
        {p.is_published && p.slug ? (
          <Button asChild variant="ghost">
            <a href={`/${p.slug}`} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" /> View live
            </a>
          </Button>
        ) : null}
        {p.id && p.is_published ? (
          <ConfirmButton
            trigger={<Button variant="ghost">Unpublish</Button>}
            title={`Hide "${p.title}"?`}
            body={`/${p.slug} will show "Page not found" until you publish again.`}
            confirmLabel="Hide page"
            onConfirm={async () => {
              const r = await unpublishPage({ id: p.id! });
              toast[r.ok ? "success" : "error"](r.message);
              router.refresh();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
