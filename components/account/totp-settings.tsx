"use client";

import { useActionState, useState } from "react";

import { removeTotpFactor } from "@/app/admin/mfa/actions";
import { FormMessage } from "@/components/auth/form-message";
import { TotpChallenge } from "@/components/mfa/totp-challenge";
import { TotpEnroll } from "@/components/mfa/totp-enroll";
import { Button } from "@/components/ui/button";

/** Optional TOTP for parents; staff see it too (they can't remove their last factor). */
export function TotpSettings({ factorId, aal }: { factorId: string | null; aal: "aal1" | "aal2" }) {
  const [enrolling, setEnrolling] = useState(false);
  const [state, action, pending] = useActionState(removeTotpFactor, null);

  if (!factorId) {
    return enrolling ? (
      <TotpEnroll doneHref="/account/security" />
    ) : (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Add a code from an authenticator app when you sign in.</p>
        <Button type="button" variant="outline" onClick={() => setEnrolling(true)}>
          Set up authenticator app
        </Button>
      </div>
    );
  }

  if (aal !== "aal2") {
    return (
      <div className="space-y-2">
        <p className="text-sm">Authenticator app is on. Enter a code to manage it.</p>
        <TotpChallenge factorId={factorId} doneHref="/account/security" />
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <p className="text-sm">Authenticator app is on.</p>
      <input type="hidden" name="factorId" value={factorId} />
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        Remove authenticator app
      </Button>
    </form>
  );
}
