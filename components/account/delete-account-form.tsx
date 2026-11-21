"use client";

import { useActionState } from "react";

import { deleteAccount } from "@/app/(family)/account/actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccount, null);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
        <Input
          id="confirm-delete"
          name="confirm"
          autoComplete="off"
          className="max-w-48"
          aria-describedby="confirm-delete-error"
        />
        <FieldError id="confirm-delete-error" message={state && !state.ok ? state.fieldErrors?.confirm : undefined} />
      </div>
      <FormMessage state={state && !state.ok && state.fieldErrors ? null : state} />
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Deleting…" : "Delete my account"}
      </Button>
    </form>
  );
}
