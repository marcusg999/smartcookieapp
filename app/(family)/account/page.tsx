import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser("/account");
  const supabase = await createClient();
  const [{ data: profile }, { data: passkeys }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.auth.passkey.list(),
  ]);
  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {firstName ? `Hi, ${firstName}` : "Your account"}
          </h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      {(passkeys ?? []).length === 0 ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound aria-hidden="true" className="size-5 text-primary" />
              <h2>Sign in faster with a passkey</h2>
            </CardTitle>
            <CardDescription>
              Use Face ID, Touch ID or your device PIN instead of a password.{" "}
              <Link
                href="/account/security"
                className="font-medium text-ink underline decoration-orange decoration-[3px] underline-offset-4 hover:decoration-ink"
              >
                Add a passkey
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        <li>
          <Link
            href="/account/security"
            className="block rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader>
                <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
                <CardTitle>Security</CardTitle>
                <CardDescription>Sign-in methods, passkeys, password, two-factor, devices.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </li>
        <li>
          <Link
            href="/account/privacy"
            className="block rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader>
                <Lock aria-hidden="true" className="size-5 text-primary" />
                <CardTitle>Privacy</CardTitle>
                <CardDescription>Download your data or delete your account.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </li>
      </ul>
    </div>
  );
}
