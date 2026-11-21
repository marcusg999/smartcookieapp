"use client";

import { History, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/fields";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/auth/action-result";
import type { ContentDef, ContentGroup } from "@/lib/content/registry";
import { richTextToPlain, type RichNode } from "@/lib/validation/rich-text";

import { discardContentDraft, publishContent, restoreContentVersion, saveContentDraft } from "./actions";

export type BlockState = {
  draft: unknown;
  published: unknown;
  publishedAt: string | null;
  versions: { id: string; value: unknown; created_at: string }[];
};

const notify = (r: ActionResult<unknown>) => (r.ok ? toast.success(r.message ?? "Done") : toast.error(r.message));

/** Human-readable version of any value, for history diffs. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value;
  if (typeof value === "object" && (value as RichNode).type === "doc") return richTextToPlain(value as RichNode);
  if (Array.isArray(value))
    return value.map((s: { title?: string; body?: string }) => `• ${s.title ?? ""}: ${s.body ?? ""}`).join("\n");
  if (typeof value === "object" && "label" in (value as object)) {
    const c = value as { label: string; href: string };
    return `${c.label} → ${c.href}`;
  }
  return JSON.stringify(value);
}

export function SiteTextEditor({
  group,
  blocks,
  pendingTotal,
}: {
  group: ContentGroup;
  blocks: Record<string, BlockState>;
  pendingTotal: number;
}) {
  const router = useRouter();
  const pendingHere = group.items
    .filter((i) => JSON.stringify(blocks[i.key]?.draft) !== JSON.stringify(blocks[i.key]?.published))
    .map((i) => i.key);

  return (
    <div className="space-y-4">
      {pendingTotal > 0 ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink bg-accent p-3"
          role="status"
        >
          <span className="font-semibold">
            {pendingTotal} unpublished change{pendingTotal === 1 ? "" : "s"} across the site.
          </span>
          <div className="flex gap-2">
            {pendingHere.length ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  notify(await publishContent({ keys: pendingHere }));
                  router.refresh();
                }}
              >
                Publish this section
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={async () => {
                notify(await publishContent({}));
                router.refresh();
              }}
            >
              Publish everything
            </Button>
          </div>
        </div>
      ) : null}
      {group.items.map((def) => (
        <BlockEditor key={def.key} def={def} state={blocks[def.key]!} onChanged={() => router.refresh()} />
      ))}
    </div>
  );
}

function BlockEditor({ def, state, onChanged }: { def: ContentDef; state: BlockState; onChanged: () => void }) {
  const [value, setValue] = useState<unknown>(state.draft);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const changedLocally = JSON.stringify(value) !== JSON.stringify(state.draft);
  const unpublished = JSON.stringify(state.draft) !== JSON.stringify(state.published);
  const id = `block-${def.key.replace(/\./g, "-")}`;

  async function run(fn: () => Promise<ActionResult<unknown>>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    notify(r);
    if (r.ok) onChanged();
  }

  return (
    <section className="rounded-2xl border-2 border-ink bg-paper p-4" aria-labelledby={`${id}-label`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-label`} className="font-bold">
          {def.label}
        </h2>
        <span className="flex items-center gap-2 text-xs font-semibold">
          <span className="rounded-full border-2 border-ink px-2 py-0.5 capitalize">{def.type.replace("_", " ")}</span>
          {unpublished ? (
            <span className="rounded-full border-2 border-ink bg-orange px-2 py-0.5">Draft, not live yet</span>
          ) : (
            <span className="text-muted-foreground">Live</span>
          )}
        </span>
      </div>
      {def.help ? <p className="mb-2 text-sm text-muted-foreground">{def.help}</p> : null}
      <ValueEditor id={id} def={def} value={value} onChange={setValue} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!changedLocally || busy}
          onClick={() => run(() => saveContentDraft({ key: def.key, value }))}
        >
          Save draft
        </Button>
        {unpublished && !changedLocally ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => publishContent({ keys: [def.key] }))}
            >
              Publish
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                await run(() => discardContentDraft({ key: def.key }));
                setValue(state.published);
              }}
            >
              Discard draft
            </Button>
          </>
        ) : null}
        {state.versions.length ? (
          <Button size="sm" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <History aria-hidden="true" /> History ({state.versions.length})
          </Button>
        ) : null}
      </div>
      {showHistory ? (
        <ol className="mt-3 space-y-2" aria-label={`${def.label} history`}>
          {state.versions.map((v) => (
            <li
              key={v.id}
              className="grid gap-2 rounded-xl border-2 border-ink/40 bg-card p-3 text-sm sm:grid-cols-[1fr_1fr_auto]"
            >
              <div>
                <p className="text-xs font-bold text-muted-foreground">
                  Published {new Date(v.created_at).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap">{describe(v.value)}</p>
              </div>
              <div className="border-l-4 border-orange pl-2">
                <p className="text-xs font-bold text-muted-foreground">Current draft</p>
                <p className="whitespace-pre-wrap">{describe(state.draft)}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  await run(() => restoreContentVersion({ versionId: v.id }));
                  setValue(v.value);
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function ValueEditor({
  id,
  def,
  value,
  onChange,
}: {
  id: string;
  def: ContentDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (def.type === "rich_text") {
    return <RichTextEditor id={id} label={def.label} value={(value as RichNode) ?? null} onChange={onChange} />;
  }
  if (def.type === "cta") {
    const cta = (value as { label?: string; href?: string }) ?? {};
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-l`} label="Button text">
          <Input
            id={`${id}-l`}
            value={cta.label ?? ""}
            maxLength={60}
            onChange={(e) => onChange({ ...cta, label: e.target.value })}
          />
        </Field>
        <Field id={`${id}-h`} label="Goes to" help="A page like /menu, or a full https:// link">
          <Input id={`${id}-h`} value={cta.href ?? ""} onChange={(e) => onChange({ ...cta, href: e.target.value })} />
        </Field>
      </div>
    );
  }
  if (def.type === "json") {
    const steps = (Array.isArray(value) ? value : []) as { title: string; body: string; bubble?: string }[];
    const update = (i: number, patch: object) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    return (
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-xl border-2 border-ink/40 p-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label={`Step ${i + 1} title`}
              value={s.title}
              placeholder="Title"
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <Input
              aria-label={`Step ${i + 1} speech bubble`}
              value={s.bubble ?? ""}
              placeholder="Speech bubble"
              onChange={(e) => update(i, { bubble: e.target.value })}
            />
            <Button
              variant="ghost"
              aria-label={`Remove step ${i + 1}`}
              onClick={() => onChange(steps.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
            <textarea
              aria-label={`Step ${i + 1} text`}
              value={s.body}
              rows={2}
              className="rounded-md border-2 border-ink bg-card px-3 py-2 sm:col-span-3"
              onChange={(e) => update(i, { body: e.target.value })}
            />
          </div>
        ))}
        {steps.length < 6 ? (
          <Button size="sm" variant="outline" onClick={() => onChange([...steps, { title: "", body: "", bubble: "" }])}>
            <Plus aria-hidden="true" /> Add step
          </Button>
        ) : null}
      </div>
    );
  }
  const text = typeof value === "string" ? value : "";
  return (
    <textarea
      id={id}
      aria-labelledby={`${id}-label`}
      rows={Math.min(6, Math.max(1, Math.ceil(text.length / 70)))}
      value={text}
      maxLength={1000}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-md border-2 border-ink bg-card px-3 py-2"
    />
  );
}
