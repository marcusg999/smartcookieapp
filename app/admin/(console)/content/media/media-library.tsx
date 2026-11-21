"use client";

import { Copy, ImagePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmButton } from "@/components/admin/confirm";
import { EmptyState } from "@/components/admin/page-header";
import { MealImage } from "@/components/menu/meal-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { deleteMedia, updateMediaAlt, uploadMedia } from "./actions";

type M = { id: string; storage_path: string; alt_text: string; width: number | null; height: number | null; usage: number };

export function MediaLibrary({ items }: { items: M[] }) {
  const router = useRouter();
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    if (!alt.trim()) return void toast.error("First describe the image in the alt text box.");
    setBusy(true);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("alt_text", alt.trim());
      const r = await uploadMedia(fd);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    }
    setBusy(false);
    setAlt("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-ink bg-paper p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="media-alt">Describe the image (alt text)</Label>
          <Input id="media-alt" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} />
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="sr-only" aria-label="Choose images" onChange={(e) => e.target.files && upload(e.target.files)} />
        <Button disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus aria-hidden="true" /> {busy ? "Uploading…" : "Upload images"}</Button>
      </section>
      {items.length === 0 ? (
        <EmptyState title="No images yet" body="Upload your logo or a banner photo to use on the site." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-2xl border-2 border-ink bg-paper">
              <MealImage path={m.storage_path} alt={m.alt_text} bucket="media" className="aspect-video border-b-2 border-ink" sizes="(min-width: 1024px) 33vw, 100vw" />
              <div className="space-y-2 p-3">
                <Input aria-label="Alt text" defaultValue={m.alt_text} onBlur={async (e) => { if (e.target.value !== m.alt_text) { const r = await updateMediaAlt({ id: m.id, alt_text: e.target.value }); r.ok ? toast.success(r.message) : toast.error(r.message); } }} />
                <p className="text-xs text-muted-foreground">{m.width}×{m.height} · used in {m.usage} place{m.usage === 1 ? "" : "s"}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(m.storage_path); toast.success("Path copied."); }}><Copy aria-hidden="true" /> Copy path</Button>
                  <ConfirmButton
                    trigger={<Button size="sm" variant="ghost" disabled={m.usage > 0} title={m.usage > 0 ? "In use, so it can't be deleted" : undefined}><Trash2 aria-hidden="true" /> Delete</Button>}
                    title="Delete this image?"
                    body={m.alt_text}
                    confirmLabel="Delete image"
                    onConfirm={async () => { const r = await deleteMedia({ id: m.id }); r.ok ? toast.success(r.message) : toast.error(r.message); router.refresh(); }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
