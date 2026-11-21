"use client";

import { useActionState, useState } from "react";

import { unlinkProvider } from "@/app/(family)/account/actions";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "apple", label: "Apple" },
] as const;

export function IdentityManager({ connected, email }: { connected: string[]; email: string | null }) {
  const [state, action, pending] = useActionState(unlinkProvider, null);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function link(provider: "google" | "apple") {
    setLinkError(null);
    const { error } = await createClient().auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?link=1&next=/account/security` },
    });
    if (error) setLinkError(`${provider === "google" ? "Google" : "Apple"} isn't available right now.`);
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-md border text-sm">
        <li className="flex items-center justify-between px-3 py-2">
          <span>Email{email ? ` (${email})` : ""}</span>
          <span className="text-muted-foreground">{connected.includes("email") ? "Connected" : "Not set up"}</span>
        </li>
        {PROVIDERS.map(({ id, label }) => {
          const isConnected = connected.includes(id);
          return (
            <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>{label}</span>
              {isConnected ? (
                <form action={action}>
                  <input type="hidden" name="provider" value={id} />
                  <Button type="submit" size="sm" variant="ghost" disabled={pending}>
                    Disconnect
                  </Button>
                </form>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => link(id)}>
                  Connect
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <FormMessage state={state} />
      {linkError ? (
        <p role="alert" className="text-sm text-destructive">
          {linkError}
        </p>
      ) : null}
    </div>
  );
}
