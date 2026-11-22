import { signOutEverywhere } from "@/app/(family)/account/actions";
import { IdentityManager } from "@/components/account/identity-manager";
import { PasskeyManager } from "@/components/account/passkey-manager";
import { TotpSettings } from "@/components/account/totp-settings";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
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

function describeAgent(ua: string | null, unknown: string): string {
  if (!ua) return unknown;
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
  const c = await getContent();
  const [{ data: identities }, { data: factors }, { data: sessions }, { data: passkeys }] = await Promise.all([
    supabase.auth.getUserIdentities(),
    supabase.auth.mfa.listFactors(),
    supabase.rpc("my_sessions"),
    supabase.auth.passkey.list(),
  ]);
  const totp = factors?.totp.find((f) => f.status === "verified") ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-4xl leading-[0.95] font-black md:text-5xl">{c.text("security.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{c.text("security.methods_title")}</h2>
          </CardTitle>
          <CardDescription>{c.text("security.methods_body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <IdentityManager connected={(identities?.identities ?? []).map((i) => i.provider)} email={user.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{c.text("security.passkeys_title")}</h2>
          </CardTitle>
          <CardDescription>{c.text("security.passkeys_body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PasskeyManager initial={passkeys ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{c.text("security.password_title")}</h2>
          </CardTitle>
          <CardDescription>{c.text("security.password_body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <NewPasswordForm submitLabel={c.text("security.password_button")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{c.text("security.mfa_title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TotpSettings factorId={totp?.id ?? null} aal={user.aal} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{c.text("security.sessions_title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-md border text-sm">
            {((sessions ?? []) as SessionRow[]).map((s) => (
              <li key={s.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:justify-between">
                <span>
                  {describeAgent(s.user_agent, c.text("security.unknown_device"))}
                  {s.is_current ? (
                    <span className="font-bold text-ink"> · {c.text("security.this_device")}</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {c.text("security.active", { date: new Date(s.updated_at ?? s.created_at).toLocaleString("en-US") })}
                </span>
              </li>
            ))}
          </ul>
          <form action={signOutEverywhere}>
            <Button type="submit" variant="outline">
              {c.text("security.sign_out_everywhere")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
