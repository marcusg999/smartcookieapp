import { Download } from "lucide-react";

import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";

export const metadata = { title: "Privacy" };

export default async function AccountPrivacyPage() {
  await requireUser("/account/privacy");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Privacy</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Download your data</h2>
          </CardTitle>
          <CardDescription>A JSON file with everything we store about your household.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/account/privacy/export" download>
              <Download aria-hidden="true" /> Download my data
            </a>
          </Button>
        </CardContent>
      </Card>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>
            <h2>Delete your account</h2>
          </CardTitle>
          <CardDescription>
            This permanently deletes your account and your children&apos;s profiles. Order records required for
            accounting are kept without your personal details. This can&apos;t be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountForm />
        </CardContent>
      </Card>
    </div>
  );
}
