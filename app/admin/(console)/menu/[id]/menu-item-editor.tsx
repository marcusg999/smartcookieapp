"use client";

import { Archive, ArrowDown, ArrowUp, Copy, ImagePlus, RotateCcw, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmButton } from "@/components/admin/confirm";
import { ChipToggle, Field, formatCents, MoneyInput } from "@/components/admin/fields";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { MealImage } from "@/components/menu/meal-image";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/auth/action-result";
import type { RichNode } from "@/lib/validation/rich-text";

import {
  archiveMenuItem,
  deleteMenuImage,
  deleteMenuItem,
  duplicateMenuItem,
  restoreMenuItem,
  saveMenuImages,
  saveMenuItem,
  uploadMenuImage,
} from "../actions";

export type EditorItem = {
  id?: string;
  name: string;
  short_description: string;
  description_rich: RichNode | null;
  category_id: string | null;
  base_price_cents: number;
  school_price_cents: number | null;
  portion_label: string;
  ingredients: string;
  reheat_instructions: string;
  use_by_days: number | null;
  nutrition: { label: string; value: string }[];
  is_snack: boolean;
  is_active: boolean;
  archived: boolean;
  badge_ids: string[];
  allergens: { allergen_id: string; presence: "contains" | "may_contain" }[];
  images: { id: string; storage_path: string; alt_text: string; is_primary: boolean }[];
  stripe_price_id: string | null;
};

type Option = { id: string; name: string };

function notify(result: ActionResult<unknown>) {
  if (result.ok) toast.success(result.message ?? "Saved");
  else toast.error(result.message);
}

export function MenuItemEditor({
  item,
  categories,
  badges,
  allergens,
  priceHistory,
}: {
  item: EditorItem;
  categories: Option[];
  badges: Option[];
  allergens: (Option & { is_top9: boolean })[];
  priceHistory: { base_price_cents: number; school_price_cents: number | null; active_from: string }[];
}) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const [form, setForm] = useState(item);
  const [saved, setSaved] = useState(JSON.stringify(item));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmNone, setConfirmNone] = useState(false);
  const dirty = useMemo(() => JSON.stringify(form) !== saved, [form, saved]);
  useUnsavedGuard(dirty);

  const set = <K extends keyof EditorItem>(key: K, value: EditorItem[K]) => setForm((f) => ({ ...f, [key]: value }));
  const presence = (id: string) => form.allergens.find((a) => a.allergen_id === id)?.presence ?? null;
  const setPresence = (id: string, value: "contains" | "may_contain" | null) =>
    set("allergens", [
      ...form.allergens.filter((a) => a.allergen_id !== id),
      ...(value ? [{ allergen_id: id, presence: value }] : []),
    ]);

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      const result = await runWithStepUp(() =>
        saveMenuItem({
          id: form.id,
          name: form.name,
          short_description: form.short_description,
          description_rich: form.description_rich ?? undefined,
          category_id: form.category_id,
          base_price_cents: form.base_price_cents,
          school_price_cents: form.school_price_cents,
          portion_label: form.portion_label,
          ingredients: form.ingredients,
          reheat_instructions: form.reheat_instructions,
          use_by_days: form.use_by_days,
          nutrition: form.nutrition.filter((n) => n.label && n.value),
          is_snack: form.is_snack,
          is_active: form.is_active,
          badge_ids: form.badge_ids,
          allergens: form.allergens,
          confirm_no_allergens: confirmNone,
        }),
      );
      notify(result);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return;
      }
      setSaved(JSON.stringify(form));
      if (!form.id && result.data?.id) router.replace(`/admin/menu/${result.data.id}`);
      else router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-5 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="basics">
        <h2 id="basics" className="text-xl font-bold">
          The basics
        </h2>
        <Field id="name" label="Meal name" error={errors.name}>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={120}
            aria-invalid={!!errors.name}
          />
        </Field>
        <Field id="short" label="One-line description" help="Shown on menu cards. Keep it short and tasty.">
          <Input
            id="short"
            value={form.short_description}
            onChange={(e) => set("short_description", e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field id="desc" label="Full description">
          <RichTextEditor
            id="desc"
            label="Full description"
            value={form.description_rich}
            onChange={(doc) => set("description_rich", doc)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="category" label="Category">
            <select
              id="category"
              value={form.category_id ?? ""}
              onChange={(e) => set("category_id", e.target.value || null)}
              className="h-11 w-full rounded-md border-2 border-ink bg-card px-3"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="portion" label="Portion" help="For example: Kid size, 8 oz.">
            <Input
              id="portion"
              value={form.portion_label}
              onChange={(e) => set("portion_label", e.target.value)}
              maxLength={60}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <ChipToggle pressed={form.is_active} onPressedChange={(v) => set("is_active", v)}>
            {form.is_active ? "Available to put on menus" : "Switched off"}
          </ChipToggle>
          <ChipToggle pressed={form.is_snack} onPressedChange={(v) => set("is_snack", v)}>
            {form.is_snack ? "This is a snack" : "This is a meal"}
          </ChipToggle>
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="pricing">
        <h2 id="pricing" className="text-xl font-bold">
          Price
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="price" label="Family price" error={errors.base_price_cents}>
            <MoneyInput id="price" cents={form.base_price_cents} onChange={(v) => set("base_price_cents", v ?? 0)} />
          </Field>
          <Field id="school-price" label="School price (optional)" help="Leave empty to use the family price.">
            <MoneyInput
              id="school-price"
              cents={form.school_price_cents}
              allowEmpty
              onChange={(v) => set("school_price_cents", v)}
            />
          </Field>
        </div>
        {form.id &&
        (form.base_price_cents !== item.base_price_cents || form.school_price_cents !== item.school_price_cents) ? (
          <p role="status" className="rounded-md border-2 border-ink bg-accent px-3 py-2 text-sm">
            Saving will ask for your authenticator code. The new price applies to new orders; existing orders keep their
            price.
          </p>
        ) : null}
        {priceHistory.length > 1 ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Price history</summary>
            <ul className="mt-2 space-y-1">
              {priceHistory.map((h) => (
                <li key={h.active_from}>
                  {new Date(h.active_from).toLocaleDateString()}: {formatCents(h.base_price_cents)}
                  {h.school_price_cents !== null ? ` · schools ${formatCents(h.school_price_cents)}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="allergens-h">
        <h2 id="allergens-h" className="text-xl font-bold">
          Allergens
        </h2>
        <p className="text-sm text-muted-foreground">
          Tap once for <strong>Contains</strong>, again for <strong>May contain</strong> (shared equipment), again to
          clear. Families with matching allergies won&apos;t be able to order this meal.
        </p>
        <ul className="grid gap-2 sm:grid-cols-3">
          {allergens.map((a) => {
            const p = presence(a.id);
            const next = p === null ? "contains" : p === "contains" ? "may_contain" : null;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  aria-pressed={p !== null}
                  aria-label={`${a.name}: ${p === "contains" ? "contains" : p === "may_contain" ? "may contain" : "not present"}`}
                  onClick={() => setPresence(a.id, next)}
                  className={`flex min-h-14 w-full items-center justify-between rounded-xl border-2 border-ink px-4 text-left font-bold ${p === "contains" ? "bg-allergy text-white" : p === "may_contain" ? "bg-[#f6d77a]" : "bg-card"}`}
                >
                  {a.name}
                  <span className="text-xs font-semibold uppercase">
                    {p === "contains" ? "Contains" : p === "may_contain" ? "May contain" : "–"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {form.allergens.length === 0 ? (
          <label className="flex items-start gap-3 rounded-xl border-2 border-allergy bg-card p-3 text-sm font-semibold">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={confirmNone}
              onChange={(e) => setConfirmNone(e.target.checked)}
            />
            This meal contains none of the listed allergens. (We still never promise &ldquo;allergen-free&rdquo;.)
          </label>
        ) : null}
        {errors.allergens ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {errors.allergens}
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="badges-h">
        <h2 id="badges-h" className="text-xl font-bold">
          Badges
        </h2>
        <div className="flex flex-wrap gap-2">
          {badges.map((b) => (
            <ChipToggle
              key={b.id}
              pressed={form.badge_ids.includes(b.id)}
              onPressedChange={(on) =>
                set("badge_ids", on ? [...form.badge_ids, b.id] : form.badge_ids.filter((x) => x !== b.id))
              }
            >
              {b.name}
            </ChipToggle>
          ))}
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="details-h">
        <h2 id="details-h" className="text-xl font-bold">
          Ingredients & nutrition
        </h2>
        <Field id="ingredients" label="Ingredients">
          <textarea
            id="ingredients"
            value={form.ingredients}
            onChange={(e) => set("ingredients", e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border-2 border-ink bg-card px-3 py-2"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field
            id="reheat"
            label="Reheating / serving note (on labels)"
            help="Optional, e.g. 'Microwave 60 seconds, stir.' Shown on meal labels."
          >
            <Input
              id="reheat"
              value={form.reheat_instructions}
              maxLength={160}
              onChange={(e) => set("reheat_instructions", e.target.value)}
            />
          </Field>
          <Field id="use-by" label="Use within (days)" help="Leave empty for the default in Settings → Kitchen.">
            <Input
              id="use-by"
              type="number"
              min={1}
              max={14}
              value={form.use_by_days ?? ""}
              onChange={(e) => set("use_by_days", e.target.value ? Number(e.target.value) : null)}
            />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="font-semibold">Nutrition (optional)</legend>
          {form.nutrition.map((n, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label="Nutrient"
                placeholder="Calories"
                value={n.label}
                onChange={(e) =>
                  set(
                    "nutrition",
                    form.nutrition.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  )
                }
              />
              <Input
                aria-label="Amount"
                placeholder="320"
                value={n.value}
                onChange={(e) =>
                  set(
                    "nutrition",
                    form.nutrition.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                aria-label="Remove row"
                onClick={() =>
                  set(
                    "nutrition",
                    form.nutrition.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set("nutrition", [...form.nutrition, { label: "", value: "" }])}
          >
            Add a nutrition row
          </Button>
        </fieldset>
      </section>

      {form.id ? <ImageManager itemId={form.id} images={item.images} /> : null}

      {form.id ? (
        <section
          className="flex flex-wrap gap-2 rounded-2xl border-2 border-dashed border-ink/50 p-4"
          aria-label="More actions"
        >
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const r = await runWithStepUp(() => duplicateMenuItem({ id: form.id! }));
              notify(r);
              if (r.ok && r.data) router.push(`/admin/menu/${r.data.id}`);
            }}
          >
            <Copy aria-hidden="true" /> Duplicate
          </Button>
          {item.archived ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                notify(await restoreMenuItem({ id: form.id! }));
                router.refresh();
              }}
            >
              <RotateCcw aria-hidden="true" /> Restore
            </Button>
          ) : (
            <ConfirmButton
              trigger={
                <Button type="button" variant="outline">
                  <Archive aria-hidden="true" /> Archive
                </Button>
              }
              title={`Archive "${item.name}"?`}
              body="It disappears from menus and the meal list but stays in past orders. You can restore it from the Archived view."
              confirmLabel="Archive meal"
              onConfirm={async () => {
                notify(await archiveMenuItem({ id: form.id! }));
                router.refresh();
              }}
            />
          )}
          <ConfirmButton
            trigger={
              <Button type="button" variant="ghost">
                <Trash2 aria-hidden="true" /> Delete
              </Button>
            }
            title={`Delete "${item.name}" for good?`}
            body="Only meals that were never ordered or put on a menu can be deleted. Otherwise, archive it."
            confirmLabel="Delete meal"
            onConfirm={async () => {
              const r = await deleteMenuItem({ id: form.id! });
              notify(r);
              if (r.ok) router.push("/admin/menu");
            }}
          />
        </section>
      ) : null}

      <UnsavedBar
        dirty={dirty || !form.id}
        saving={saving}
        onSave={save}
        onDiscard={form.id ? () => setForm(JSON.parse(saved)) : undefined}
        saveLabel={form.id ? "Save changes" : "Create meal"}
      />
    </div>
  );
}

function ImageManager({ itemId, images: initial }: { itemId: string; images: EditorItem["images"] }) {
  const router = useRouter();
  const [images, setImages] = useState(initial);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = JSON.stringify(images) !== JSON.stringify(initial);

  async function upload(files: FileList | File[]) {
    if (!alt.trim()) {
      toast.error("First describe the photo in the alt text box (for screen readers).");
      return;
    }
    setBusy(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("menu_item_id", itemId);
      fd.set("alt_text", alt.trim());
      fd.set("file", file);
      notify(await uploadMenuImage(fd));
    }
    setBusy(false);
    setAlt("");
    router.refresh();
  }

  const move = (i: number, d: number) => {
    const next = [...images];
    const [img] = next.splice(i, 1);
    next.splice(i + d, 0, img!);
    setImages(next);
  };

  return (
    <section className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="photos-h">
      <h2 id="photos-h" className="text-xl font-bold">
        Photos
      </h2>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files);
        }}
        className={`space-y-3 rounded-xl border-2 border-dashed border-ink p-4 ${dragOver ? "bg-accent" : "bg-card"}`}
      >
        <Field
          id="alt"
          label="Describe the photo (alt text)"
          help="Required. For example: Mac and cheese in a blue bowl with broccoli."
        >
          <Input id="alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
        </Field>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="sr-only"
          aria-label="Choose photos"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <ImagePlus aria-hidden="true" /> {busy ? "Uploading…" : "Choose photos or drop them here"}
        </Button>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP or AVIF up to 8 MB. Location data is removed automatically.
        </p>
      </div>

      {images.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {images.map((img, i) => (
            <li key={img.id} className="flex gap-3 rounded-xl border-2 border-ink bg-card p-2">
              <MealImage
                path={img.storage_path}
                alt={img.alt_text}
                className="size-24 shrink-0 rounded-lg"
                sizes="96px"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Input
                  aria-label="Alt text"
                  value={img.alt_text}
                  onChange={(e) =>
                    setImages(images.map((x) => (x.id === img.id ? { ...x, alt_text: e.target.value } : x)))
                  }
                />
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={img.is_primary ? "default" : "outline"}
                    aria-pressed={img.is_primary}
                    onClick={() => setImages(images.map((x) => ({ ...x, is_primary: x.id === img.id })))}
                  >
                    <Star aria-hidden="true" /> {img.is_primary ? "Main photo" : "Make main"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={i === images.length - 1}
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <ConfirmButton
                    trigger={
                      <Button type="button" size="sm" variant="ghost" aria-label="Remove photo">
                        <Trash2 className="size-4" />
                      </Button>
                    }
                    title="Remove this photo?"
                    body={img.alt_text}
                    confirmLabel="Remove photo"
                    onConfirm={async () => {
                      notify(await deleteMenuImage({ id: img.id, menu_item_id: itemId }));
                      router.refresh();
                    }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {changed ? (
        <Button
          type="button"
          onClick={async () => {
            notify(await saveMenuImages({ menu_item_id: itemId, images }));
            router.refresh();
          }}
        >
          Save photo changes
        </Button>
      ) : null}
    </section>
  );
}
