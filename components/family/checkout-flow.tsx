"use client";

import { Check, CheckCircle2, Loader2, MapPin, PartyPopper, School, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { orderPaymentStatus, placeOrder, previewDiscount, saveNamedOrder, startPayment } from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import { priceCart, type CartLine, type ChildAllergy, type PlanAllowance, type ZoneFees } from "@/lib/ordering/logic";
import { formatDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { AllergyChips, fmt, type Copy } from "./kit";
import { StripePayment } from "./stripe-payment";

type Kid = { id: string; first_name: string; allergies: ChildAllergy[]; school_id: string | null };
type Address = { id: string; label: string; zone: (ZoneFees & { name: string }) | null; is_default: boolean };
type Meal = { id: string; name: string; price_cents: number; is_snack: boolean };

const STEPS = ["review", "delivery", "allergies", "payment"] as const;
type Step = (typeof STEPS)[number];

export function CheckoutFlow({
  copy,
  week,
  lines,
  meals,
  kids,
  addresses,
  plan,
  usedElsewhere,
  disclaimer,
}: {
  copy: Copy;
  week: { id: string; label: string };
  lines: CartLine[];
  meals: Meal[];
  kids: Kid[];
  addresses: Address[];
  plan: PlanAllowance | null;
  usedElsewhere: { meals: Record<string, number>; snacks: Record<string, number> };
  disclaimer: ReactNode;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("review");
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState<{ code: string; cents: number } | null>(null);
  const kidsInCart = kids.filter((k) => lines.some((l) => l.childId === k.id));
  const canSchool = kidsInCart.length > 0 && kidsInCart.every((k) => k.school_id);
  const [fulfillment, setFulfillment] = useState<"delivery" | "school_dropoff">(
    addresses.length === 0 && canSchool ? "school_dropoff" : "delivery",
  );
  const [addressId, setAddressId] = useState(addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const mealMap = useMemo(() => new Map(meals.map((m) => [m.id, m])), [meals]);
  const zone = fulfillment === "delivery" ? (addresses.find((a) => a.id === addressId)?.zone ?? null) : null;
  const totals = priceCart({
    lines,
    meals: Object.fromEntries(meals.map((m) => [m.id, { priceCents: m.price_cents, isSnack: m.is_snack }])),
    plan,
    usedElsewhere,
    zone,
  });
  const discountCents = discount ? Math.min(discount.cents, totals.subtotalCents) : 0;
  const estimate = totals.subtotalCents + totals.deliveryFeeCents - discountCents;
  const deliveryReady =
    fulfillment === "school_dropoff" ? canSchool : Boolean(addressId && zone) && !totals.belowMinimum;

  const place = (confirmIds: string[]) =>
    start(async () => {
      const res = await placeOrder({
        weekId: week.id,
        fulfillment,
        addressId: fulfillment === "delivery" ? addressId : null,
        discountCode: discount?.code ?? null,
        allergiesConfirmed: true,
        confirmedChildIds: confirmIds,
        notes: notes || null,
      });
      if (!res.ok) return void toast.error(res.message);
      setStep("payment");
      const change = res.data!.change;
      if (change?.kind === "charged")
        toast.success(fmt(copy.change_charged, { amount: formatCents(change.amountCents ?? 0) }));
      if (change?.kind === "refunded")
        toast.success(fmt(copy.change_refunded, { amount: formatCents(change.amountCents ?? 0) }));
      // Payment renders from the saved order, so a refresh never loses it.
      router.replace(`/checkout?order=${res.data!.orderId}`);
    });

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <ol className="mb-6 grid grid-cols-4 gap-1.5" aria-label={copy.title}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? "step" : undefined}
            className={cn(
              "rounded-lg border-2 border-ink px-1 py-1.5 text-center text-xs font-bold sm:text-sm",
              i < stepIndex ? "bg-ink text-paper" : s === step ? "bg-orange shadow-ink-sm" : "bg-paper",
            )}
          >
            {i < stepIndex ? <Check aria-hidden="true" className="mr-1 inline size-3.5" /> : null}
            {copy[`step_${s}`]}
          </li>
        ))}
      </ol>

      {step === "review" ? (
        <section className="space-y-5">
          {kidsInCart.map((k) => {
            const mine = totals.lines
              .filter((l) => l.childId === k.id)
              .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
            return (
              <div key={k.id} className="rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-black">{k.first_name}</h2>
                  <AllergyChips allergies={k.allergies} size="xs" />
                </div>
                <ul className="mt-2 divide-y divide-ink/10">
                  {mine.map((l) => (
                    <li key={`${l.menuItemId}${l.deliveryDate}`} className="flex justify-between gap-3 py-1.5 text-sm">
                      <span>
                        <span className="font-semibold">{formatDay(l.deliveryDate)}</span> ·{" "}
                        {mealMap.get(l.menuItemId)?.name} × {l.quantity}
                      </span>
                      <span className="shrink-0 font-semibold">
                        {l.coveredQty
                          ? `${copy.included}${l.paidQty ? ` + ${formatCents(l.paidQty * l.unitPriceCents)}` : ""}`
                          : formatCents(l.paidQty * l.unitPriceCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await previewDiscount({ code, subtotalCents: totals.subtotalCents });
                if (!res.ok) {
                  setDiscount(null);
                  return void toast.error(copy.code_invalid);
                }
                setDiscount({ code, cents: res.data!.discountCents });
              });
            }}
          >
            <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
              {copy.discount_code}
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={40}
                autoCapitalize="characters"
              />
            </label>
            <Button type="submit" variant="outline" disabled={!code || pending}>
              {copy.apply}
            </Button>
          </form>
          <Totals copy={copy} totals={totals} discountCents={discountCents} estimate={estimate} zone={zone} />
          <div className="flex justify-between gap-3">
            <Button asChild variant="outline" size="lg">
              <Link href={`/order?week=${week.id}`}>{copy.edit}</Link>
            </Button>
            <Button size="lg" onClick={() => setStep("delivery")}>
              {copy.continue}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "delivery" ? (
        <section className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="sr-only">{copy.step_delivery}</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-ink bg-paper p-4 has-checked:bg-orange-tint has-checked:shadow-ink">
              <input
                type="radio"
                name="fulfillment"
                checked={fulfillment === "delivery"}
                onChange={() => setFulfillment("delivery")}
                className="mt-1 size-5 accent-[var(--ink)]"
              />
              <span className="flex-1">
                <span className="flex items-center gap-2 font-bold">
                  <MapPin aria-hidden="true" className="size-4" /> {copy.deliver_home}
                </span>
                {fulfillment === "delivery" ? (
                  addresses.length ? (
                    <span className="mt-2 block space-y-2">
                      {addresses.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="address"
                            checked={addressId === a.id}
                            onChange={() => setAddressId(a.id)}
                            className="size-4 accent-[var(--ink)]"
                          />
                          <span>
                            {a.label}
                            {a.zone ? (
                              <span className="ml-1 text-muted-foreground">· {a.zone.name}</span>
                            ) : (
                              <span className="ml-1 font-semibold text-destructive">✕</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </span>
                  ) : null
                ) : null}
                <Link
                  href="/account/addresses?return=/checkout"
                  className="mt-2 inline-block text-sm font-semibold underline decoration-orange decoration-[3px] underline-offset-4"
                >
                  {copy.add_address}
                </Link>
              </span>
            </label>
            {canSchool ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-ink bg-paper p-4 has-checked:bg-orange-tint has-checked:shadow-ink">
                <input
                  type="radio"
                  name="fulfillment"
                  checked={fulfillment === "school_dropoff"}
                  onChange={() => setFulfillment("school_dropoff")}
                  className="mt-1 size-5 accent-[var(--ink)]"
                />
                <span>
                  <span className="flex items-center gap-2 font-bold">
                    <School aria-hidden="true" className="size-4" /> {copy.deliver_school}
                  </span>
                  <span className="block text-sm text-muted-foreground">{copy.school_note}</span>
                </span>
              </label>
            ) : null}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {copy.notes}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={2}
              className="rounded-md border-2 border-ink bg-paper px-3 py-2 font-normal"
            />
          </label>
          <Totals copy={copy} totals={totals} discountCents={discountCents} estimate={estimate} zone={zone} />
          <div className="flex justify-between gap-3">
            <Button variant="outline" size="lg" onClick={() => setStep("review")}>
              {copy.back}
            </Button>
            <Button size="lg" disabled={!deliveryReady} onClick={() => setStep("allergies")}>
              {copy.continue}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "allergies" ? (
        <section className="space-y-4" aria-labelledby="allergy-h">
          <h2 id="allergy-h" className="text-3xl font-black">
            {copy.allergy_title}
          </h2>
          <div className="rounded-xl border-2 border-allergy bg-paper p-4 text-sm">{disclaimer}</div>
          <ul className="space-y-3">
            {kidsInCart.map((k) => {
              const ok = confirmed.includes(k.id);
              return (
                <li
                  key={k.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-paper p-4",
                    ok && "bg-orange-tint",
                  )}
                >
                  <div className="space-y-1">
                    <p className="text-lg font-black">{k.first_name}</p>
                    <AllergyChips allergies={k.allergies} emptyLabel={copy.allergy_none} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href="/children" className="text-sm font-semibold underline">
                      {copy.allergy_edit}
                    </Link>
                    <Button
                      variant={ok ? "secondary" : "outline"}
                      aria-pressed={ok}
                      onClick={() => setConfirmed(ok ? confirmed.filter((id) => id !== k.id) : [...confirmed, k.id])}
                    >
                      {ok ? <CheckCircle2 aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                      {ok ? copy.allergy_confirmed : copy.allergy_correct}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <Totals copy={copy} totals={totals} discountCents={discountCents} estimate={estimate} zone={zone} />
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <Button variant="outline" size="lg" onClick={() => setStep("delivery")}>
              {copy.back}
            </Button>
            {confirmed.length === kidsInCart.length ? (
              <Button size="lg" disabled={pending || !deliveryReady} onClick={() => place(confirmed)}>
                {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {pending ? copy.placing : copy.place}
              </Button>
            ) : (
              // Returning families: one tap confirms every child and places the order.
              <Button size="lg" disabled={pending || !deliveryReady} onClick={() => place(kidsInCart.map((k) => k.id))}>
                {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
                {copy.allergy_all}
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {step === "payment" ? <p className="text-center font-semibold">{copy.placing}</p> : null}
    </div>
  );
}

function Totals({
  copy,
  totals,
  discountCents,
  estimate,
  zone,
}: {
  copy: Copy;
  totals: ReturnType<typeof priceCart>;
  discountCents: number;
  estimate: number;
  zone: (ZoneFees & { name: string }) | null;
}) {
  const included = totals.lines.reduce((n, l) => n + l.coveredQty, 0);
  return (
    <dl className="space-y-1 rounded-2xl border-2 border-ink bg-paper p-4 text-sm">
      <div className="flex justify-between">
        <dt>{copy.subtotal}</dt>
        <dd className="font-semibold">{formatCents(totals.subtotalCents)}</dd>
      </div>
      {included ? (
        <div className="flex justify-between">
          <dt>{copy.included}</dt>
          <dd className="font-semibold">× {included}</dd>
        </div>
      ) : null}
      {zone ? (
        <div className="flex justify-between">
          <dt>
            {copy.delivery_fee}
            {zone.freeOverCents !== null && totals.deliveryFeeCents > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground">
                ({fmt(copy.free_over, { amount: formatCents(zone.freeOverCents) })})
              </span>
            ) : null}
          </dt>
          <dd className="font-semibold">
            {totals.deliveryFeeCents ? formatCents(totals.deliveryFeeCents) : copy.free}
          </dd>
        </div>
      ) : null}
      {discountCents ? (
        <div className="flex justify-between">
          <dt>{copy.discount}</dt>
          <dd className="font-semibold">−{formatCents(discountCents)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between border-t-2 border-ink pt-2 text-lg font-black">
        <dt>{copy.total}</dt>
        <dd>{formatCents(estimate)}</dd>
      </div>
      {totals.belowMinimum && zone ? (
        <p role="alert" className="font-semibold text-destructive">
          {fmt(copy.minimum, { amount: formatCents(zone.minOrderCents) })}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{copy.estimate_note}</p>
    </dl>
  );
}

/**
 * Step 4: pay for a placed order. Stripe: the Payment Element for exactly
 * what's owed (the server created the PaymentIntent), then a "processing"
 * screen until the webhook marks the order paid. Mock (CI): one button.
 */
export function PaymentPanel({
  copy,
  placed,
  lines,
  replacing,
  testMode,
  returnUrl,
  redirected,
}: {
  copy: Copy;
  placed: { orderId: string; orderNumber: string; dueCents: number; status: string };
  lines: CartLine[];
  replacing: boolean;
  testMode: boolean;
  returnUrl: string;
  redirected: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"pay" | "card" | "processing" | "paid" | "failed">(
    placed.status !== "pending_payment" ? "paid" : redirected ? "processing" : "pay",
  );
  const [secret, setSecret] = useState<{ clientSecret: string; amountCents: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [pending, start] = useTransition();
  const begun = useRef(false);

  const begin = () =>
    start(async () => {
      const res = await startPayment({ orderId: placed.orderId });
      if (!res.ok) return void toast.error(res.message);
      if (res.data!.kind === "client_secret") {
        setSecret({ clientSecret: res.data!.clientSecret!, amountCents: res.data!.amountCents! });
        setPhase("card");
      } else setPhase("paid");
    });

  // Real payments: open the card form straight away (no extra tap).
  useEffect(() => {
    if (!testMode && phase === "pay" && !begun.current) {
      begun.current = true;
      begin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Processing: the webhook decides. Poll until the order is paid (or failed).
  useEffect(() => {
    if (phase !== "processing") return;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      const res = await orderPaymentStatus({ orderId: placed.orderId });
      if (res.ok && res.data?.paid) {
        clearInterval(id);
        setPhase("paid");
        router.refresh();
      } else if (res.ok && res.data?.error && tries > 3) {
        clearInterval(id);
        setFailure(res.data.error);
        setPhase("failed");
      } else if (tries > 40) {
        clearInterval(id);
      }
    }, 1500);
    return () => clearInterval(id);
  }, [phase, placed.orderId, router]);

  const paid = phase === "paid";
  return (
    <div className="mx-auto w-full max-w-2xl">
      <section className="space-y-5">
        {paid ? (
          <div className="rounded-3xl border-2 border-ink bg-orange p-6 text-center shadow-ink-lg">
            <PartyPopper aria-hidden="true" className="mx-auto size-12 animate-[pop_.5s_ease-out]" />
            <h2 className="mt-2 text-4xl font-black">{copy.done_title}</h2>
            <p className="mt-2">{copy.done_body}</p>
            <p className="mt-3 font-black">{placed.orderNumber}</p>
          </div>
        ) : phase === "processing" ? (
          <div role="status" className="rounded-2xl border-2 border-ink bg-paper p-6 text-center shadow-ink-lg">
            <Loader2 aria-hidden="true" className="mx-auto size-10 animate-spin" />
            <h2 className="mt-3 text-2xl font-black">{copy.processing}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy.processing_body}</p>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-ink bg-paper p-6 shadow-ink-lg">
            <h2 className="text-3xl font-black">{copy.pay_title}</h2>
            <p className="mt-2">{fmt(copy.pay_body, { number: placed.orderNumber })}</p>
            <p className="mt-4 text-4xl font-black">{formatCents(secret?.amountCents ?? placed.dueCents)}</p>
            {phase === "failed" && failure ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border-2 border-destructive p-3 text-sm font-semibold text-destructive"
              >
                {fmt(copy.payment_failed, { reason: failure })}
              </p>
            ) : null}
            {phase === "card" && secret ? (
              <div className="mt-5">
                <StripePayment
                  clientSecret={secret.clientSecret}
                  amountLabel={fmt(copy.pay_button, { amount: formatCents(secret.amountCents) })}
                  returnUrl={returnUrl}
                  copy={copy}
                  onConfirmed={() => setPhase("processing")}
                />
              </div>
            ) : testMode ? (
              <>
                <Button size="lg" className="mt-4 w-full" disabled={pending} onClick={begin}>
                  {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                  {fmt(copy.pay_button, { amount: formatCents(placed.dueCents) })}
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">{copy.pay_test_note}</p>
              </>
            ) : (
              <div className="mt-4 flex justify-center">
                {pending ? (
                  <Loader2 aria-hidden="true" className="size-8 animate-spin" />
                ) : (
                  <Button size="lg" onClick={begin}>
                    {copy.retry_payment}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {placed.dueCents === 0 && !paid ? <p className="text-center text-sm">{copy.nothing_to_pay}</p> : null}
        {paid && !replacing ? (
          <form
            className="flex items-end gap-2 rounded-2xl border-2 border-dashed border-ink p-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await saveNamedOrder({ name: saveName, lines });
                if (!res.ok) return void toast.error(res.message);
                toast.success(copy.save_combo);
                setSaveName("");
              });
            }}
          >
            <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
              {copy.save_combo}
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={80} required />
            </label>
            <Button type="submit" variant="outline" disabled={pending}>
              <Check aria-hidden="true" />
            </Button>
          </form>
        ) : null}
        <div className="flex justify-center">
          <Button
            size="lg"
            variant={paid ? "default" : "outline"}
            onClick={() => router.push(`/orders/${placed.orderId}`)}
          >
            {copy.view_order}
          </Button>
        </div>
      </section>
    </div>
  );
}
