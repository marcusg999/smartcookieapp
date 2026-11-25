"use client";

import { School, Users } from "lucide-react";
import { useActionState, useState } from "react";

import { signUp } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { cn } from "@/lib/utils";

import { FieldError, FormMessage } from "./form-message";
import { OAuthButtons } from "./oauth-buttons";
import { PasswordStrengthMeter } from "./password-strength-meter";
import { Turnstile } from "./turnstile";

export function SignUpForm({
  pilotMode = false,
  initialType = "parent",
  initialCode = "",
}: {
  pilotMode?: boolean;
  initialType?: "parent" | "school";
  initialCode?: string;
}) {
  const [accountType, setAccountType] = useState<"parent" | "school">(initialType);
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [state, action, pending] = useActionState(signUp, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) return <FormMessage state={state} />;

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Who are you ordering for?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "parent", label: "I'm a parent", icon: Users },
              { value: "school", label: "I'm ordering for a school", icon: School },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-center text-sm font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                accountType === value ? "border-primary bg-primary/5" : "bg-card",
              )}
            >
              <input
                type="radio"
                name="accountTypeChoice"
                value={value}
                checked={accountType === value}
                onChange={() => setAccountType(value)}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="size-5 text-primary" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {accountType === "school" ? (
        <div className="space-y-2">
          <Label htmlFor="organizationName">School name</Label>
          <Input
            id="organizationName"
            name="organizationName"
            form="signup-form"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            aria-invalid={Boolean(errors?.organizationName)}
            aria-describedby="organizationName-error organizationName-help"
            maxLength={120}
          />
          <p id="organizationName-help" className="text-sm text-muted-foreground">
            We review new schools before school ordering opens.
          </p>
          <FieldError id="organizationName-error" message={errors?.organizationName} />
        </div>
      ) : null}

      <OAuthButtons
        label="Sign up"
        accountType={accountType}
        organizationName={accountType === "school" ? organizationName : undefined}
      />

      <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        or with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form id="signup-form" action={action} className="space-y-4" noValidate>
        <input type="hidden" name="accountType" value={accountType} />
        {pilotMode ? (
          <div className="space-y-2 rounded-xl border-2 border-ink bg-orange-tint p-3">
            <Label htmlFor="pilotCode">Invite code</Label>
            <Input
              id="pilotCode"
              name="pilotCode"
              defaultValue={initialCode}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={40}
              required
              aria-invalid={Boolean(errors?.pilotCode)}
              aria-describedby="pilotCode-help pilotCode-error"
            />
            <p id="pilotCode-help" className="text-sm text-muted-foreground">
              We&apos;re in a small pilot right now. Enter the code from your invitation.
            </p>
            <FieldError id="pilotCode-error" message={errors?.pilotCode} />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="fullName">Your name</Label>
          <Input id="fullName" name="fullName" autoComplete="name" maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(errors?.email)}
            aria-describedby="email-error"
          />
          <FieldError id="email-error" message={errors?.email} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(errors?.password)}
            aria-describedby="password-help password-strength password-error"
          />
          <p id="password-help" className="text-sm text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters. A short sentence works well.
          </p>
          <PasswordStrengthMeter id="password-strength" password={password} />
          <FieldError id="password-error" message={errors?.password} />
        </div>
        <Turnstile action="sign_up" />
        <FormMessage state={state} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating your account…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
