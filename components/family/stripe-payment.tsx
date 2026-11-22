"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { publicEnv } from "@/lib/env.public";

import type { Copy } from "./kit";

// Loaded once, from js.stripe.com (never bundled), as PCI SAQ-A requires.
let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = () => (stripePromise ??= loadStripe(publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY));

// The Payment Element in the site's palette (ink outlines, cream fields).
const appearance: Appearance = {
  theme: "flat",
  variables: {
    colorPrimary: "#1f3b2d",
    colorBackground: "#fff9f5",
    colorText: "#1f3b2d",
    colorDanger: "#c8102e",
    fontFamily: '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSizeBase: "16px",
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "2px solid #1f3b2d", boxShadow: "none" },
    ".Input:focus": { boxShadow: "0 0 0 3px #f4b4b6" },
    ".Tab": { border: "2px solid #1f3b2d" },
    ".Tab--selected": { backgroundColor: "#f4b4b6", boxShadow: "2px 2px 0 0 #1f3b2d" },
    ".Label": { fontWeight: "600" },
  },
};

/**
 * Card / Link / Apple Pay / Google Pay via Stripe's Payment Element. The
 * amount on the button is display-only: the PaymentIntent was created on the
 * server for exactly what's owed. Stripe handles 3D Secure in a modal (or a
 * redirect back to `returnUrl`). Payment state is settled by the webhook.
 */
export function StripePayment(props: {
  clientSecret: string;
  amountLabel: string;
  returnUrl: string;
  copy: Copy;
  onConfirmed: () => void;
}) {
  return (
    <Elements stripe={getStripe()} options={{ clientSecret: props.clientSecret, appearance, loader: "always" }}>
      <PaymentForm {...props} />
    </Elements>
  );
}

function PaymentForm({
  amountLabel,
  returnUrl,
  copy,
  onConfirmed,
}: Omit<Parameters<typeof StripePayment>[0], "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });
    setBusy(false);
    if (err) {
      // Card and validation errors are safe and specific; anything else is generic.
      setError(
        err.type === "card_error" || err.type === "validation_error" ? (err.message ?? copy.pay_error) : copy.pay_error,
      );
      return;
    }
    if (paymentIntent && ["succeeded", "processing", "requires_capture"].includes(paymentIntent.status)) onConfirmed();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={{ layout: { type: "tabs" } }} onReady={() => setReady(true)} />
      {error ? (
        <p
          role="alert"
          className="rounded-lg border-2 border-destructive bg-paper p-3 text-sm font-semibold text-destructive"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={!stripe || !ready || busy}>
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Lock aria-hidden="true" />}
        {busy ? copy.processing : amountLabel}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock aria-hidden="true" className="size-3" /> {copy.secure_note}
      </p>
    </form>
  );
}
