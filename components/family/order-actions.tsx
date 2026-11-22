"use client";

import { CreditCard, Pencil, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { cancelOrder, modifyOrder } from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";

import type { Copy } from "./kit";

/** Change / cancel (before cutoff) and pay (pending) buttons for one order. */
export function OrderActions({
  copy,
  orderId,
  canChange,
  canPay,
}: {
  copy: Copy;
  orderId: string;
  canChange: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {canPay ? (
        <Button disabled={pending} onClick={() => router.push(`/checkout?order=${orderId}`)}>
          <CreditCard aria-hidden="true" />
          {copy.pay}
        </Button>
      ) : null}
      {canChange ? (
        <>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await modifyOrder({ orderId });
                if (!res.ok) return void toast.error(res.message);
                router.push(`/order?week=${res.data!.weekId}`);
              })
            }
          >
            <Pencil aria-hidden="true" /> {copy.modify}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!confirm(copy.cancel_confirm)) return;
              start(async () => {
                const res = await cancelOrder({ orderId });
                if (!res.ok) return void toast.error(res.message);
                toast.success(copy.cancelled);
                router.refresh();
              });
            }}
          >
            <XCircle aria-hidden="true" /> {copy.cancel}
          </Button>
        </>
      ) : null}
    </div>
  );
}
