"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { requestMagicLink, signInWithPassword } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { FormMessage } from "./form-message";
import { Turnstile } from "./turnstile";

/** One email field: "Email me a link" (magic link) or "Use a password". */
export function SignInForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"link" | "password">("link");
  const [linkState, linkAction, linkPending] = useActionState(requestMagicLink, null);
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, null);
  const state = mode === "link" ? linkState : pwState;
  const pending = linkPending || pwPending;

  return (
    <form action={mode === "link" ? linkAction : pwAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username webauthn" required inputMode="email" />
      </div>
      {mode === "password" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-sm text-ink underline decoration-orange decoration-[3px] underline-offset-4 hover:decoration-ink"
            >
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      ) : null}
      <Turnstile action={mode === "link" ? "magic_link" : "sign_in"} />
      <FormMessage state={state} />
      <Button type="submit" className="w-full" disabled={pending}>
        {mode === "link"
          ? linkPending
            ? "Sending…"
            : "Email me a sign-in link"
          : pwPending
            ? "Signing in…"
            : "Sign in"}
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => setMode(mode === "link" ? "password" : "link")}
      >
        {mode === "link" ? "Use a password instead" : "Email me a link instead"}
      </button>
    </form>
  );
}
