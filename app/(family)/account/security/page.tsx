import { signOutEverywhere } from "@/app/(family)/account/actions";
import { IdentityManager } from "@/components/account/identity-manager";
import { PasskeyManager } from "@/components/account/passkey-manager";
import { TotpSettings } from "@/components/account/totp-settings";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Security" };

type SessionRow = {
  id: string;
  created_at: string;
  updated_at: string | null;
  user_agent: string | null;
  ip: string | null;
  aal: string;
  is_current: boolean;
};

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export default async function AccountSecurityPage() {
  const user = await requireUser("/account/security");
  const supabase = await createClient();
  const [{ data: identities }, { data: factors }, { data: sessions }, { data: passkeys }] = await Promise.all([
    supabase.auth.getUserIdentities(),
    supabase.auth.mfa.listFactors(),
    supabase.rpc("my_sessions"),
    supabase.auth.passkey.list(),
  ]);
  const totp = factors?.totp.find((f) => f.status === "verified") ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Security</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Sign-in methods</h2>
          </CardTitle>
          <CardDescription>At least one method always stays connected.</CardDescription>
        </CardHeader>
        <CardContent>
          <IdentityManager connected={(identities?.identities ?? []).map((i) => i.provider)} email={user.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Passkeys</h2>
          </CardTitle>
          <CardDescription>The fastest and most secure way to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasskeyManager initial={passkeys ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Password</h2>
          </CardTitle>
          <CardDescription>Changing it signs out your other devices.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewPasswordForm submitLabel="Change password" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Two-factor authentication</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TotpSettings factorId={totp?.id ?? null} aal={user.aal} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Where you&apos;re signed in</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-md border text-sm">
            {((sessions ?? []) as SessionRow[]).map((s) => (
              <li key={s.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:justify-between">
                <span>
                  {describeAgent(s.user_agent)}
                  {s.is_current ? <span className="font-medium text-primary"> · this device</span> : null}
                </span>
                <span className="text-muted-foreground">
                  Active {new Date(s.updated_at ?? s.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          <form action={signOutEverywhere}>
            <Button type="submit" variant="outline">
              Sign out everywhere
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
