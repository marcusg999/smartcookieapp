"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Passkey sign-in (WebAuthn, native Supabase Auth API). Discoverable
 * credentials: no email needed; the authenticator picks the account.
 */
export function PasskeySignIn({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn() {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPasskey();
    setPending(false);
    if (signInError) {
      setError("Passkey sign-in didn't complete. Try again, or use another method.");
      return;
    }
    // The session cookie is set; let the server pick the right home page.
    router.replace(`/auth/after-sign-in?method=passkey${next ? `&next=${encodeURIComponent(next)}` : ""}`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" className="w-full" onClick={signIn} disabled={pending}>
        <KeyRound aria-hidden="true" />
        {pending ? "Waiting for your passkey…" : "Sign in with a passkey"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
