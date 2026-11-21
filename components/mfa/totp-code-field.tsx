import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { FieldError } from "../auth/form-message";

export function TotpCodeField({ error, autoFocus = true }: { error?: string; autoFocus?: boolean }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="totp-code">6-digit code</Label>
      <Input
        id="totp-code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,7}"
        maxLength={7}
        required
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby="totp-code-error"
        className="max-w-40 font-mono text-lg tracking-widest"
      />
      <FieldError id="totp-code-error" message={error} />
    </div>
  );
}
