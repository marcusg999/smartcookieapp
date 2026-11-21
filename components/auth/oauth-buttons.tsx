"use client";

import { useActionState } from "react";

import { signInWithOAuth } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

import { FormMessage } from "./form-message";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
      />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
      <path d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5a11 11 0 0 0 1.4-2.9 4.5 4.5 0 0 1-2.6-4.1zM13.9 5.1A4.4 4.4 0 0 0 15 1.9a4.6 4.6 0 0 0-3 1.5 4.3 4.3 0 0 0-1.1 3.1c1.2.1 2.3-.6 3-1.4z" />
    </svg>
  );
}

/** Google and Apple buttons. Each submits a Server Action that redirects to the provider (PKCE). */
export function OAuthButtons({
  next,
  accountType,
  organizationName,
  label = "Continue",
}: {
  next?: string;
  accountType?: "parent" | "school";
  organizationName?: string;
  label?: string;
}) {
  const [state, action, pending] = useActionState(signInWithOAuth, null);
  return (
    <form action={action} className="space-y-2">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {accountType ? <input type="hidden" name="accountType" value={accountType} /> : null}
      {organizationName ? <input type="hidden" name="organizationName" value={organizationName} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="submit" name="provider" value="google" variant="outline" disabled={pending}>
          <GoogleIcon />
          {label} with Google
        </Button>
        <Button type="submit" name="provider" value="apple" variant="outline" disabled={pending}>
          <AppleIcon />
          {label} with Apple
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
