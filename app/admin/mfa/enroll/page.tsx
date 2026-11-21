import { redirect } from "next/navigation";

import { TotpEnroll } from "@/components/mfa/totp-enroll";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Set up two-factor authentication" };

export default async function AdminMfaEnrollPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Already has a verified factor: verify it instead of enrolling another.
  if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") redirect("/admin/mfa/challenge");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold">Set up two-factor authentication</h1>
        </CardTitle>
        <CardDescription>
          Staff accounts must use an authenticator app. It protects customer and allergy data if your password is ever
          stolen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TotpEnroll doneHref="/admin" />
      </CardContent>
    </Card>
  );
}
