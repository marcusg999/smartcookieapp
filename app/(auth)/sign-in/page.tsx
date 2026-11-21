import Link from "next/link";

import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { PasskeySignIn } from "@/components/auth/passkey-sign-in";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/auth/redirect";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  idle: "You were signed out after 30 minutes of inactivity.",
  expired: "Your admin session reached its 12-hour limit. Please sign in again.",
  link: "That link is invalid or has expired. Request a new one below.",
  oauth: "That sign-in didn't complete. Please try again.",
  missing_code: "That sign-in didn't complete. Please try again.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? safeNext(params.next, "") : "";
  const noticeKey =
    (typeof params.reason === "string" && params.reason) || (typeof params.error === "string" && params.error) || "";
  const notice = NOTICES[noticeKey];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold">Sign in</h1>
        </CardTitle>
        <CardDescription>Welcome back to Smart Cookie.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {notice ? (
          <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm">
            {notice}
          </p>
        ) : null}
        <OAuthButtons next={nextParam || undefined} />
        <PasskeySignIn next={nextParam || undefined} />
        <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
          <span className="h-px flex-1 bg-border" />
          or with email
          <span className="h-px flex-1 bg-border" />
        </div>
        <SignInForm next={nextParam || undefined} />
        <p className="text-center text-sm text-muted-foreground">
          New to Smart Cookie?{" "}
          <Link
            href="/sign-up"
            className="font-medium text-ink underline decoration-orange decoration-[3px] underline-offset-4 hover:decoration-ink"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
