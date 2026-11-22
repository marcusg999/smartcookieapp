"use client";

import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, School, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  checkZip,
  completeOnboarding,
  joinWaitlist,
  saveAddress,
  saveHousehold,
  setOrderingPreference,
} from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Child } from "@/lib/family/queries";
import { cn } from "@/lib/utils";

import { AddressFields, type AddressValue } from "./address-form";
import type { SchoolOption } from "./child-form";
import { ChildrenManager } from "./children-manager";
import { fmt, type Copy } from "./kit";
import type { PlanCard } from "./subscription-panel";

const TOTAL = 4;

/**
 * First sign-in: household → address (zone check, waitlist, or school
 * drop-off) → kids with allergies → à la carte or a plan. Skippable at every
 * step, but the account home nudges until it's done.
 */
export function Onboarding({
  copy,
  kidsCopy,
  household,
  hasAddress,
  kids,
  allergens,
  badges,
  schools,
  plans,
}: {
  copy: Copy;
  kidsCopy: Copy;
  household: { name: string; phone: string; preference: "a_la_carte" | "subscription" | null; planId: string | null };
  hasAddress: boolean;
  kids: Child[];
  allergens: { id: string; name: string; is_top9: boolean }[];
  badges: { name: string }[];
  schools: SchoolOption[];
  plans: PlanCard[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [pending, start] = useTransition();
  const [name, setName] = useState(household.name);
  const [phone, setPhone] = useState(household.phone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [addr, setAddr] = useState<AddressValue>({ line1: "", line2: "", city: "", zip: "", deliveryNotes: "" });
  const [zip, setZip] = useState<{ covered: boolean; zone?: string; days?: string } | null>(null);
  const [waitlisted, setWaitlisted] = useState(false);
  const [preferSchool, setPreferSchool] = useState(false);
  const [preference, setPreference] = useState(household.preference ?? "a_la_carte");
  const [planId, setPlanId] = useState(household.planId ?? plans[0]?.id ?? null);

  const next = () => {
    setStep((s) => Math.min(TOTAL, s + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveStep1 = () =>
    start(async () => {
      const res = await saveHousehold({ name, phone });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.message);
      }
      setErrors({});
      next();
    });

  const check = () =>
    start(async () => {
      const res = await checkZip({ zip: addr.zip });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? { zip: res.message });
        return;
      }
      setErrors({});
      setZip(res.data ?? null);
    });

  const saveStep2 = () =>
    start(async () => {
      const res = await saveAddress({ ...addr, state: "CA", makeDefault: true });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.message);
      }
      setErrors({});
      next();
    });

  const finish = () =>
    start(async () => {
      const pref = await setOrderingPreference({ preference, planId: preference === "subscription" ? planId : null });
      if (!pref.ok) return void toast.error(pref.message);
      const res = await completeOnboarding();
      if (!res.ok) return void toast.error(res.message);
      router.push(preference === "subscription" ? "/subscription" : "/order");
    });

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6">
        <p className="text-sm font-bold">{fmt(copy.step_of, { n: step, total: TOTAL })}</p>
        <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-2.5 rounded-full border-2 border-ink transition-colors duration-300",
                i < step ? "bg-orange" : "bg-paper",
              )}
            />
          ))}
        </div>
      </div>

      <div key={step} className="animate-in duration-300 fade-in slide-in-from-right-6 motion-reduce:animate-none">
        {step === 1 ? (
          <section className="space-y-5">
            <h2 className="text-3xl font-black">{copy.household_title}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="hh-name" className="font-semibold">
                {copy.household_name}
              </Label>
              <Input
                id="hh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name ? <p className="text-sm font-semibold text-destructive">{errors.name}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hh-phone" className="font-semibold">
                {copy.household_phone}
              </Label>
              <Input
                id="hh-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={32}
                aria-invalid={Boolean(errors.phone)}
              />
              {errors.phone ? <p className="text-sm font-semibold text-destructive">{errors.phone}</p> : null}
            </div>
            <Nav copy={copy} pending={pending} onNext={saveStep1} />
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-5">
            <h2 className="flex items-center gap-2 text-3xl font-black">
              <MapPin aria-hidden="true" className="size-7" /> {copy.address_title}
            </h2>
            {hasAddress ? (
              <p className="rounded-xl border-2 border-ink bg-orange-tint p-3 font-semibold">{copy.saved}</p>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="zip-check" className="font-semibold">
                  {copy.address_zip}
                </Label>
                <Input
                  id="zip-check"
                  inputMode="numeric"
                  maxLength={10}
                  value={addr.zip}
                  onChange={(e) => {
                    setAddr({ ...addr, zip: e.target.value });
                    setZip(null);
                  }}
                />
              </div>
              <Button variant="outline" onClick={check} disabled={pending || addr.zip.length < 5}>
                {copy.zip_check}
              </Button>
            </div>
            {errors.zip ? <p className="text-sm font-semibold text-destructive">{errors.zip}</p> : null}

            {zip?.covered ? (
              <>
                <p
                  role="status"
                  className="flex items-center gap-2 rounded-xl border-2 border-ink bg-orange p-3 font-bold"
                >
                  <Check aria-hidden="true" /> {fmt(copy.zip_ok, { zone: zip.zone ?? "", days: zip.days ?? "" })}
                </p>
                <AddressFields copy={copy} value={addr} onChange={setAddr} errors={errors} />
              </>
            ) : null}
            {zip && !zip.covered ? (
              <div role="status" className="space-y-3 rounded-xl border-2 border-ink bg-paper p-4">
                <p className="font-bold">{copy.zip_no}</p>
                <p>{fmt(copy.waitlist_body, { zip: addr.zip })}</p>
                {waitlisted ? (
                  <p className="font-semibold">{copy.waitlist_done}</p>
                ) : (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await joinWaitlist({ zip: addr.zip });
                        if (!res.ok) return void toast.error(res.message);
                        setWaitlisted(true);
                      })
                    }
                  >
                    {copy.waitlist_cta}
                  </Button>
                )}
              </div>
            ) : null}

            {schools.length ? (
              <div className="rounded-xl border-2 border-dashed border-ink p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <School aria-hidden="true" className="size-5" /> {copy.school_offer}
                </p>
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    setPreferSchool(true);
                    next();
                  }}
                >
                  {copy.school_cta}
                </Button>
              </div>
            ) : null}
            <Nav copy={copy} pending={pending} onBack={() => setStep(1)} onNext={zip?.covered ? saveStep2 : next} />
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-5">
            <h2 className="text-3xl font-black">{copy.kids_title}</h2>
            <p>{copy.kids_body}</p>
            <ChildrenManager
              copy={kidsCopy}
              kids={kids}
              allergens={allergens}
              badges={badges}
              schools={schools}
              preferSchool={preferSchool}
            />
            <Nav copy={copy} pending={pending} onBack={() => setStep(2)} onNext={next} />
          </section>
        ) : null}

        {step === 4 ? (
          <section className="space-y-5">
            <h2 className="text-3xl font-black">{copy.plan_title}</h2>
            <fieldset className="space-y-3">
              <legend className="sr-only">{copy.plan_title}</legend>
              {(["a_la_carte", "subscription"] as const).map((p) => (
                <label
                  key={p}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-ink bg-paper p-4 transition-transform has-checked:-rotate-[0.5deg] has-checked:bg-orange has-checked:shadow-ink"
                >
                  <input
                    type="radio"
                    name="pref"
                    checked={preference === p}
                    onChange={() => setPreference(p)}
                    className="mt-1 size-5 accent-[var(--ink)]"
                  />
                  <span>
                    <span className="block text-lg font-black">
                      {p === "a_la_carte" ? copy.plan_a_la_carte : copy.plan_subscribe}
                    </span>
                    <span className="block text-sm">
                      {p === "a_la_carte" ? copy.plan_a_la_carte_body : copy.plan_subscribe_body}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {preference === "subscription" && plans.length ? (
              <ul className="grid gap-3 sm:grid-cols-3">
                {plans.map((p) => (
                  <li key={p.id}>
                    <label className="flex h-full cursor-pointer flex-col rounded-2xl border-2 border-ink bg-paper p-4 has-checked:bg-orange-tint has-checked:shadow-ink">
                      <input
                        type="radio"
                        name="plan"
                        className="sr-only"
                        checked={planId === p.id}
                        onChange={() => setPlanId(p.id)}
                      />
                      <span className="font-black">{p.name}</span>
                      <span className="text-2xl font-black">
                        {p.priceLabel} <span className="text-xs font-semibold">{p.intervalLabel}</span>
                      </span>
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {p.points.map((pt) => (
                          <li key={pt} className="flex gap-1">
                            <Check aria-hidden="true" className="size-3 shrink-0" /> {pt}
                          </li>
                        ))}
                      </ul>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" size="lg" onClick={() => setStep(3)}>
                <ArrowLeft aria-hidden="true" /> {copy.back}
              </Button>
              <Button size="lg" onClick={finish} disabled={pending}>
                {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Sparkles aria-hidden="true" />}
                {copy.finish}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <p className="mt-8 text-center">
        <Link
          href="/account?skip=1"
          className="font-semibold underline decoration-orange decoration-[3px] underline-offset-4"
        >
          {copy.skip}
        </Link>
      </p>
    </div>
  );
}

function Nav({
  copy,
  pending,
  onBack,
  onNext,
}: {
  copy: Copy;
  pending: boolean;
  onBack?: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onBack ? (
        <Button variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> {copy.back}
        </Button>
      ) : (
        <span />
      )}
      <Button size="lg" onClick={onNext} disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {copy.next} <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}
