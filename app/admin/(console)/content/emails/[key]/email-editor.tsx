"use client";

import { Eye, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ChipToggle, Field } from "@/components/admin/fields";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RichNode } from "@/lib/validation/rich-text";

import { previewEmail, saveEmailTemplate, sendTestEmail } from "../actions";

type T = { key: string; subject: string; preheader: string; body: RichNode; is_active: boolean };

export function EmailEditor({ template, variables }: { template: T; variables: { name: string; label: string }[] }) {
  const [t, setT] = useState(template);
  const [saved, setSaved] = useState(JSON.stringify(template));
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const dirty = useMemo(() => JSON.stringify(t) !== saved, [t, saved]);
  useUnsavedGuard(dirty);

  async function copyVariable(name: string) {
    await navigator.clipboard.writeText(`{{${name}}}`);
    toast.success(`Copied {{${name}}}. Paste it where you want it.`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5">
        <Field id="em-subject" label="Subject line"><Input id="em-subject" value={t.subject} maxLength={200} onChange={(e) => setT({ ...t, subject: e.target.value })} /></Field>
        <Field id="em-pre" label="Preview text" help="Shown after the subject in most inboxes."><Input id="em-pre" value={t.preheader} maxLength={200} onChange={(e) => setT({ ...t, preheader: e.target.value })} /></Field>
        <Field id="em-body" label="Message"><RichTextEditor key={editorKey} id="em-body" label="Message" value={t.body} onChange={(d) => setT({ ...t, body: d })} /></Field>
        <div>
          <p className="mb-2 text-sm font-semibold">Insert a detail (copies it, then paste):</p>
          <div className="flex flex-wrap gap-1.5">
            {variables.map((v) => (
              <button key={v.name} type="button" onClick={() => copyVariable(v.name)} className="rounded-full border-2 border-ink bg-card px-3 py-1 text-xs font-bold hover:bg-accent" title={`{{${v.name}}}`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <ChipToggle pressed={t.is_active} onPressedChange={(v) => setT({ ...t, is_active: v })}>{t.is_active ? "This email is on" : "This email is off"}</ChipToggle>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => { const r = await previewEmail(t); if (r.ok && r.data) setPreview(r.data as { subject: string; html: string }); else if (!r.ok) toast.error(r.message); }}>
            <Eye aria-hidden="true" /> Preview
          </Button>
          <Button variant="outline" onClick={async () => { const r = await sendTestEmail(t); r.ok ? toast.success(r.message) : toast.error(r.message); }}>
            <Send aria-hidden="true" /> Send a test to me
          </Button>
        </div>
      </div>
      <div className="rounded-2xl border-2 border-ink bg-paper p-3">
        {preview ? (
          <>
            <p className="mb-2 px-2 text-sm"><strong>Subject:</strong> {preview.subject}</p>
            {/* Sandboxed: no scripts, no same-origin access. */}
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[640px] w-full rounded-lg border-2 border-ink bg-white" />
          </>
        ) : (
          <p className="p-6 text-center text-muted-foreground">Press Preview to see the email with sample details.</p>
        )}
      </div>
      <div className="lg:col-span-2">
        <UnsavedBar
          dirty={dirty}
          saving={saving}
          onDiscard={() => { setT(JSON.parse(saved)); setEditorKey((k) => k + 1); }}
          onSave={async () => {
            setSaving(true);
            const r = await saveEmailTemplate(t);
            setSaving(false);
            if (!r.ok) return void toast.error(r.message);
            toast.success(r.message);
            setSaved(JSON.stringify(t));
          }}
        />
      </div>
    </div>
  );
}
