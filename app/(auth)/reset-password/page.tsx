import { NewPasswordForm } from "@/components/auth/new-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // Reached from a recovery link, which signs the user in.
  await requireUser("/forgot-password");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold">Choose a new password</h1>
        </CardTitle>
        <CardDescription>Other devices will be signed out.</CardDescription>
      </CardHeader>
      <CardContent>
        <NewPasswordForm />
      </CardContent>
    </Card>
  );
}
