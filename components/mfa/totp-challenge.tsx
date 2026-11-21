"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { verifyRecoveryCode, verifyTotp } from "@/app/admin/mfa/actions";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { TotpCodeField } from "./totp-code-field";

/** Verify an existing TOTP factor (or a backup code) to reach AAL2. */
export function TotpChallenge({
  factorId,
  purpose = "challenge",
  onVerified,
  doneHref,
}: {
  factorId: string;
  purpose?: "challenge" | "step_up";
  onVerified?: () => void;
  doneHref?: string;
}) {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [state, action, pending] = useActionState(verifyTotp, null);
  const [backupState, backupAction, backupPending] = useActionState(verifyRecoveryCode, null);

  useEffect(() => {
    if (!state?.ok && !backupState?.ok) return;
    if (onVerified) onVerified();
    else if (doneHref) {
      router.replace(doneHref);
      router.refresh();
    }
  }, [state, backupState, onVerified, doneHref, router]);

  if (useBackup) {
    return (
      <form action={backupAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="recovery-code">Backup code</Label>
          <Input id="recovery-code" name="recoveryCode" autoComplete="one-time-code" required autoFocus />
        </div>
        <FormMessage state={backupState} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={backupPending}>
            {backupPending ? "Verifying…" : "Verify backup code"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setUseBackup(false)}>
            Use authenticator app
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="purpose" value={purpose} />
      <TotpCodeField error={state && !state.ok ? state.fieldErrors?.code : undefined} />
      <FormMessage state={state && !state.ok ? state : null} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Verify"}
        </Button>
        {purpose === "challenge" ? (
          <Button type="button" variant="ghost" onClick={() => setUseBackup(true)}>
            Use a backup code
          </Button>
        ) : null}
      </div>
    </form>
  );
}
