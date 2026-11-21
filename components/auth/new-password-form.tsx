"use client";

import { useActionState, useState } from "react";

import { updatePassword } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

import { FieldError, FormMessage } from "./form-message";
import { PasswordStrengthMeter } from "./password-strength-meter";

export function NewPasswordForm({ submitLabel = "Save new password" }: { submitLabel?: string }) {
  const [password, setPassword] = useState("");
  const [state, action, pending] = useActionState(updatePassword, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(errors?.password)}
          aria-describedby="new-password-strength new-password-error"
        />
        <PasswordStrengthMeter id="new-password-strength" password={password} />
        <FieldError id="new-password-error" message={errors?.password} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(errors?.confirm)}
          aria-describedby="confirm-password-error"
        />
        <FieldError id="confirm-password-error" message={errors?.confirm} />
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
