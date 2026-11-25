"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { markDelivered, sendPaymentReminder, setPrepCheck } from "@/app/admin/(console)/kitchen/actions";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/auth/action-result";
import { cn } from "@/lib/utils";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionResult<unknown>>, quiet = false) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.message);
      else if (!quiet) toast.success(r.message ?? "Done.");
      router.refresh();
    });
  return { pending, act };
}

/** Big tappable checkbox: "Prepared allergy-safe" for one flagged meal. */
export function PrepCheck({
  itemId,
  checked,
  label,
  by,
}: {
  itemId: string;
  checked: boolean;
  label: string;
  by?: string | null;
}) {
  const { pending, act } = useAct();
  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-1 text-base font-bold",
        checked ? "border-ink bg-orange-tint" : "border-ink/40",
      )}
    >
      <input
        type="checkbox"
        className="size-6 accent-[var(--ink)]"
        checked={checked}
        disabled={pending}
        onChange={(e) => act(() => setPrepCheck({ order_item_id: itemId, checked: e.target.checked }), true)}
        aria-label={label}
      />
      {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      <span>{checked ? `Checked${by ? ` by ${by}` : ""}` : "Prep check"}</span>
    </label>
  );
}

export function DeliveredToggle({
  orderIds,
  date,
  delivered,
  label,
}: {
  orderIds: string[];
  date: string;
  delivered: boolean;
  label: string;
}) {
  const { pending, act } = useAct();
  return (
    <Button
      size="lg"
      variant={delivered ? "default" : "outline"}
      disabled={pending}
      aria-pressed={delivered}
      aria-label={label}
      className="min-h-12 min-w-36 text-base"
      onClick={() => act(() => markDelivered({ order_ids: orderIds, date, delivered: !delivered }))}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : delivered ? (
        <Check aria-hidden="true" />
      ) : null}
      {delivered ? "Delivered" : "Mark delivered"}
    </Button>
  );
}

export function ReminderButton({ orderId, sentAt }: { orderId: string; sentAt: string | null }) {
  const { pending, act } = useAct();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => act(() => sendPaymentReminder({ order_id: orderId }))}
    >
      {sentAt ? "Remind again" : "Send payment reminder"}
    </Button>
  );
}

/** A server action button with optional step-up (week lifecycle actions). */
export function ActionButton({
  run,
  children,
  confirm,
  stepUp = false,
  variant = "outline",
}: {
  run: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  confirm?: string;
  stepUp?: boolean;
  variant?: "outline" | "default";
}) {
  const { pending, act } = useAct();
  const runWithStepUp = useStepUp();
  return (
    <Button
      size="lg"
      variant={variant}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        act(() => (stepUp ? runWithStepUp(run) : run()));
      }}
    >
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
