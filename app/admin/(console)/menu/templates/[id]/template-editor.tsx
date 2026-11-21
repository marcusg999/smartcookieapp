"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/fields";
import { ItemListBuilder, type BuilderItem, type CatalogItem } from "@/components/admin/menu/item-list-builder";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { useStepUp } from "@/components/mfa/step-up";
import { Input } from "@/components/ui/input";

import { saveTemplate } from "../../weeks/actions";

export function TemplateEditor({
  template,
  items,
  catalog,
}: {
  template: { id: string; name: string; description: string };
  items: BuilderItem[];
  catalog: CatalogItem[];
}) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const initial = { ...template, items };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => JSON.stringify(form) !== saved, [form, saved]);
  useUnsavedGuard(dirty);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-2xl border-2 border-ink bg-paper p-5 sm:grid-cols-2">
        <Field id="tpl-name" label="Template name">
          <Input
            id="tpl-name"
            value={form.name}
            maxLength={80}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field id="tpl-desc" label="Short description">
          <Input
            id="tpl-desc"
            value={form.description}
            maxLength={500}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
      </section>
      <section className="rounded-2xl border-2 border-ink bg-paper p-5">
        <ItemListBuilder items={form.items} onChange={(next) => setForm({ ...form, items: next })} catalog={catalog} />
      </section>
      <UnsavedBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setForm(JSON.parse(saved))}
        onSave={async () => {
          setSaving(true);
          const r = await runWithStepUp(() => saveTemplate(form));
          setSaving(false);
          if (r.ok) {
            toast.success(r.message);
            setSaved(JSON.stringify(form));
            router.refresh();
          } else toast.error(r.message);
        }}
      />
    </div>
  );
}
