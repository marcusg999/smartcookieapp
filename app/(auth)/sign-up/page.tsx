import Link from "next/link";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold">Create your account</h1>
        </CardTitle>
        <CardDescription>Order healthy meals for your kids or your school.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SignUpForm />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-ink underline decoration-orange decoration-[3px] underline-offset-4 hover:decoration-ink"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
