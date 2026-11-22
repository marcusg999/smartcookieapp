import { Download } from "lucide-react";

import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";

export const metadata = { title: "Privacy" };

export default async function AccountPrivacyPage() {
  await requireUser("/account/privacy");
  const c = await getContent();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-4xl leading-[0.95] font-black md:text-5xl">{c.text("privacy.title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{c.text("privacy.export_title")}</h2>
          </CardTitle>
          <CardDescription>{c.text("privacy.export_body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/account/privacy/export" download>
              <Download aria-hidden="true" /> {c.text("privacy.export_button")}
            </a>
          </Button>
        </CardContent>
      </Card>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>
            <h2>{c.text("privacy.delete_title")}</h2>
          </CardTitle>
          <CardDescription>{c.text("privacy.delete_body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountForm />
        </CardContent>
      </Card>
    </div>
  );
}
