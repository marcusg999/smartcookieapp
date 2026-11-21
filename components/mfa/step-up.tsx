"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/auth/action-result";

import { TotpChallenge } from "./totp-challenge";

type Runner = <T>(action: () => Promise<ActionResult<T>>) => Promise<ActionResult<T>>;

const StepUpContext = createContext<Runner | null>(null);

/**
 * Step-up re-authentication (CLAUDE.md §5.5). Wrap sensitive admin actions
 * with `runWithStepUp`: if the server answers `step_up_required`, a modal asks
 * for a fresh TOTP code, then the action is retried once.
 */
export function StepUpProvider({ factorId, children }: { factorId: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((verified: boolean) => void) | null>(null);

  const run = useCallback<Runner>(
    async (action) => {
      const first = await action();
      if (first.ok || first.error !== "step_up_required" || !factorId) return first;
      const verified = await new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpen(true);
      });
      return verified ? action() : first;
    },
    [factorId],
  );

  function close(verified: boolean) {
    setOpen(false);
    resolver.current?.(verified);
    resolver.current = null;
  }

  return (
    <StepUpContext.Provider value={run}>
      {children}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm it&apos;s you</DialogTitle>
            <DialogDescription>
              This is a sensitive action. Enter a fresh code from your authenticator app to continue.
            </DialogDescription>
          </DialogHeader>
          {factorId && open ? (
            <TotpChallenge factorId={factorId} purpose="step_up" onVerified={() => close(true)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): Runner {
  const run = useContext(StepUpContext);
  if (!run) throw new Error("useStepUp must be used inside <StepUpProvider>");
  return run;
}
