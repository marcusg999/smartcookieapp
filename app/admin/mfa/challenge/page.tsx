import { redirect } from "next/navigation";

import { TotpChallenge } from "@/components/mfa/totp-challenge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Verify it's you" };

export default async function AdminMfaChallengePage() {
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor) redirect("/admin/mfa/enroll");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold">Verify it&apos;s you</h1>
        </CardTitle>
        <CardDescription>Enter the code from your authenticator app to open the admin portal.</CardDescription>
      </CardHeader>
      <CardContent>
        <TotpChallenge factorId={factor.id} doneHref="/admin" />
      </CardContent>
    </Card>
  );
}
