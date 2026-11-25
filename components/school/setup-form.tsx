"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveSchoolDetails } from "@/app/(school)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Field, textareaClass, useRun, type Copy } from "./kit";

export type SetupValue = {
  name: string;
  billing_email: string;
  contact_phone: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  dropoff_entrance: string;
  dropoff_contact: string;
  dropoff_window: string;
  dropoff_instructions: string;
};

/** School details, billing email and drop-off instructions (school admin). */
export function SetupForm({ copy, initial, firstTime }: { copy: Copy; initial: SetupValue; firstTime: boolean }) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useRun(copy);
  const router = useRouter();
  const set = (k: keyof SetupValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));
  const input = (k: keyof SetupValue, label: string, opts: { type?: string; hint?: string; auto?: string } = {}) => (
    <Field id={`setup-${k}`} label={label} hint={opts.hint} error={errors[k]}>
      <Input
        id={`setup-${k}`}
        type={opts.type ?? "text"}
        value={v[k]}
        onChange={set(k)}
        autoComplete={opts.auto}
        aria-invalid={Boolean(errors[k])}
        aria-describedby={errors[k] ? `setup-${k}-error` : opts.hint ? `setup-${k}-hint` : undefined}
      />
    </Field>
  );
  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveSchoolDetails(v),
          copy["setup.saved"],
          (r) => {
            setErrors(r.fieldErrors ?? {});
            if (r.ok && firstTime) router.push("/school/classrooms");
          },
        );
      }}
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xl font-bold">{copy["setup.details"]}</legend>
        {input("name", copy["setup.name"], { auto: "organization" })}
        {input("contact_phone", copy["setup.phone"], { type: "tel", auto: "tel" })}
        {input("line1", copy["setup.address"], { auto: "address-line1" })}
        {input("city", copy["setup.city"], { auto: "address-level2" })}
        {input("state", copy["setup.state"], { auto: "address-level1" })}
        {input("zip", copy["setup.zip"], { auto: "postal-code" })}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xl font-bold">{copy["setup.billing"]}</legend>
        {input("billing_email", copy["setup.billing_email"], {
          type: "email",
          hint: copy["setup.billing_email_hint"],
          auto: "email",
        })}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xl font-bold">{copy["setup.dropoff"]}</legend>
        {input("dropoff_entrance", copy["setup.entrance"], { hint: copy["setup.entrance_hint"] })}
        {input("dropoff_contact", copy["setup.contact"], { hint: copy["setup.contact_hint"] })}
        {input("dropoff_window", copy["setup.window"], { hint: copy["setup.window_hint"] })}
        <Field
          id="setup-instructions"
          label={copy["setup.instructions"]}
          error={errors.dropoff_instructions}
          className="sm:col-span-2"
        >
          <textarea
            id="setup-instructions"
            className={textareaClass}
            value={v.dropoff_instructions}
            onChange={set("dropoff_instructions")}
          />
        </Field>
      </fieldset>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {firstTime ? copy["setup.continue"] : copy["setup.save"]}
      </Button>
    </form>
  );
}
