"use client";

import { Loader2, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteAddress, saveAddress, setDefaultAddress, toggleFavorite } from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { fmt, type Copy } from "./kit";

export type AddressValue = { line1: string; line2: string; city: string; zip: string; deliveryNotes: string };

/** Address fields shared by onboarding and the addresses page. Labels come from the CMS (onb.*). */
export function AddressFields({ copy, value, onChange, errors = {} }: { copy: Copy; value: AddressValue; onChange: (v: AddressValue) => void; errors?: Record<string, string> }) {
  const id = useId();
  const field = (key: keyof AddressValue, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-${key}`} className="font-semibold">
        {label}
      </Label>
      <Input
        id={`${id}-${key}`}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        aria-invalid={Boolean(errors[key])}
        {...props}
      />
      {errors[key] ? <p className="text-sm font-semibold text-destructive">{errors[key]}</p> : null}
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-6">{field("line1", copy.address_line1, { autoComplete: "address-line1", required: true })}</div>
      <div className="sm:col-span-6">{field("line2", copy.address_line2, { autoComplete: "address-line2" })}</div>
      <div className="sm:col-span-4">{field("city", copy.address_city, { autoComplete: "address-level2", required: true })}</div>
      <div className="sm:col-span-2">{field("zip", copy.address_zip, { autoComplete: "postal-code", inputMode: "numeric", required: true, maxLength: 10 })}</div>
      <div className="sm:col-span-6">{field("deliveryNotes", copy.address_notes)}</div>
    </div>
  );
}

export function AddressManager({
  copy,
  addresses,
  returnTo,
}: {
  copy: Copy;
  addresses: { id: string; label: string; is_default: boolean; covered: boolean; zip: string }[];
  returnTo: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<AddressValue>({ line1: "", line2: "", city: "", zip: "", deliveryNotes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(addresses.length === 0);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {addresses.length === 0 && !adding ? <p className="text-muted-foreground">{copy.empty}</p> : null}
      <ul className="space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-paper p-4">
            <span>
              <span className="block font-semibold">{a.label}</span>
              {a.is_default ? <span className="mt-1 inline-block rounded-full border-2 border-ink bg-orange px-2 text-xs font-bold">{copy.default}</span> : null}
              {!a.covered ? <span className="mt-1 block text-sm font-semibold text-destructive">{fmt(copy.not_covered, { zip: a.zip })}</span> : null}
            </span>
            <span className="flex gap-2">
              {!a.is_default ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => start(async () => {
                    const res = await setDefaultAddress({ id: a.id });
                    if (!res.ok) toast.error(res.message);
                    router.refresh();
                  })}
                >
                  <Star aria-hidden="true" /> {copy.make_default}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                aria-label={`${copy.delete}: ${a.label}`}
                onClick={() => start(async () => {
                  const res = await deleteAddress({ id: a.id });
                  if (!res.ok) toast.error(res.message);
                  router.refresh();
                })}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="space-y-4 rounded-2xl border-2 border-dashed border-ink bg-paper p-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await saveAddress({ ...value, state: "CA", makeDefault: true });
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                return void toast.error(res.message);
              }
              if (!res.data?.covered) toast.error(fmt(copy.not_covered, { zip: value.zip }));
              setValue({ line1: "", line2: "", city: "", zip: "", deliveryNotes: "" });
              setAdding(false);
              if (returnTo) router.push(returnTo);
              else router.refresh();
            });
          }}
        >
          <AddressFields copy={copy} value={value} onChange={setValue} errors={errors} />
          <Button type="submit" disabled={pending} size="lg">
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {copy.save}
          </Button>
        </form>
      ) : (
        <Button variant="outline" size="lg" onClick={() => setAdding(true)}>
          {copy.add}
        </Button>
      )}
    </div>
  );
}

/** Remove-favourite heart for the favourites page. */
export function UnfavoriteButton({ label, menuItemId, childId }: { label: string; menuItemId: string; childId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={label}
      onClick={() => start(async () => {
        const res = await toggleFavorite({ menuItemId, childId });
        if (!res.ok) toast.error(res.message);
        router.refresh();
      })}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}
