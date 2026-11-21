"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Passkey = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };

/** Add/remove passkeys (native Supabase WebAuthn). */
export function PasskeyManager({ initial }: { initial: Passkey[] }) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await createClient().auth.passkey.list();
    setPasskeys(data ?? []);
  }

  async function add() {
    setBusy(true);
    setMessage(null);
    const { error } = await createClient().auth.registerPasskey();
    setBusy(false);
    setMessage(error ? "Passkey wasn't added. Try again on a device that supports passkeys." : "Passkey added.");
    await load();
  }

  async function remove(id: string) {
    setBusy(true);
    const { error } = await createClient().auth.passkey.delete({ passkeyId: id });
    setBusy(false);
    setMessage(error ? "We couldn't remove that passkey." : "Passkey removed.");
    await load();
  }

  return (
    <div className="space-y-3">
      {passkeys === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No passkeys yet. Passkeys let you sign in with Face ID, Touch ID or your device PIN.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {passkeys.map((pk) => (
            <li key={pk.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <KeyRound aria-hidden="true" className="size-4 text-primary" />
                {pk.friendly_name || "Passkey"} · added {new Date(pk.created_at).toLocaleDateString()}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(pk.id)} disabled={busy}>
                <Trash2 aria-hidden="true" />
                <span className="sr-only">Remove passkey {pk.friendly_name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" onClick={add} disabled={busy}>
        <KeyRound aria-hidden="true" /> Add a passkey
      </Button>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
