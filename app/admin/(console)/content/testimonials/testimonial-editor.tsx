"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ChipToggle } from "@/components/admin/fields";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveTestimonials } from "../cms-actions";

type Row = { id?: string; key?: string; quote: string; attribution: string; is_published: boolean };

export function TestimonialEditor({ rows: initial }: { rows: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial.map((r) => ({ ...r, key: r.id })));
  const [deleted, setDeleted] = useState<string[]>([]);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(
    () => JSON.stringify(rows.map(({ key: _k, ...r }) => r)) !== saved || deleted.length > 0,
    [rows, saved, deleted],
  );
  useUnsavedGuard(dirty);
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const n = [...rows];
    [n[i], n[i + d]] = [n[i + d]!, n[i]!];
    setRows(n);
  };

  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <section
          key={r.key}
          className="space-y-3 rounded-2xl border-2 border-ink bg-paper p-4"
          aria-label={r.attribution || "New testimonial"}
        >
          <textarea
            aria-label="Quote"
            rows={3}
            maxLength={600}
            value={r.quote}
            placeholder="What did they say?"
            onChange={(e) => update(i, { quote: e.target.value })}
            className="w-full rounded-md border-2 border-ink bg-card px-3 py-2 text-lg italic"
          />
          <Input
            aria-label="Who said it"
            value={r.attribution}
            maxLength={120}
            placeholder="Priya, mom of two"
            onChange={(e) => update(i, { attribution: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <ChipToggle pressed={r.is_published} onPressedChange={(v) => update(i, { is_published: v })}>
              {r.is_published ? "Shown" : "Hidden"}
            </ChipToggle>
            <Button size="sm" variant="ghost" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>
              <ArrowUp className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={i === rows.length - 1}
              aria-label="Move down"
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (r.id) setDeleted([...deleted, r.id]);
                setRows(rows.filter((_, j) => j !== i));
              }}
            >
              <Trash2 aria-hidden="true" /> Remove
            </Button>
          </div>
        </section>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          setRows([...rows, { key: crypto.randomUUID(), quote: "", attribution: "", is_published: false }])
        }
      >
        <Plus aria-hidden="true" /> Add a testimonial
      </Button>
      <UnsavedBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => {
          setRows(JSON.parse(saved).map((r: Row) => ({ ...r, key: r.id })));
          setDeleted([]);
        }}
        onSave={async () => {
          setSaving(true);
          const r = await saveTestimonials({ rows: rows.map(({ key: _k, ...row }) => row), deleted });
          setSaving(false);
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setDeleted([]);
          setSaved(JSON.stringify(rows.map(({ key: _k, ...x }) => x)));
          router.refresh();
        }}
      />
    </div>
  );
}
