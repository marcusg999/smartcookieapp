"use client";

import { LogOut, UserPlus } from "lucide-react";
import { useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { useStepUp } from "@/components/mfa/step-up";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/auth/action-result";

import { changeStaffRole, forceSignOut, inviteStaff } from "./actions";

export type StaffRow = {
  user_id: string;
  email: string;
  roles: string[];
  last_sign_in_at: string | null;
  mfa_enrolled: boolean;
};

const ROLES = ["kitchen", "ops", "owner"] as const;

export function StaffManager({ staff, currentUserId }: { staff: StaffRow[]; currentUserId: string }) {
  const runWithStepUp = useStepUp();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("kitchen");

  // Not a transition: the step-up dialog's own form must be able to update
  // while this call waits for it (transitions would entangle and deadlock).
  async function run(action: () => Promise<ActionResult>) {
    setPending(true);
    try {
      setResult(await runWithStepUp(action));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="invite-heading" className="space-y-3 rounded-xl border bg-card p-4">
        <h2 id="invite-heading" className="font-semibold">
          Invite a staff member
        </h2>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteStaff({ email, role }));
          }}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:w-36"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending}>
            <UserPlus aria-hidden="true" /> Invite
          </Button>
        </form>
      </section>

      <FormMessage state={result} />

      <section aria-labelledby="staff-heading" className="space-y-3">
        <h2 id="staff-heading" className="font-semibold">
          Staff
        </h2>
        <ul className="divide-y rounded-xl border bg-card">
          {staff.map((member) => (
            <li key={member.user_id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="truncate font-medium">
                  {member.email}
                  {member.user_id === currentUserId ? <span className="text-muted-foreground"> (you)</span> : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  Last sign-in: {member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleString() : "never"} ·{" "}
                  {member.mfa_enrolled ? (
                    <Badge variant="secondary">MFA on</Badge>
                  ) : (
                    <Badge variant="destructive">No MFA yet</Badge>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {ROLES.map((r) => {
                  const has = member.roles.includes(r);
                  return (
                    <Button
                      key={r}
                      type="button"
                      size="sm"
                      variant={has ? "default" : "outline"}
                      aria-pressed={has}
                      disabled={pending}
                      onClick={() => run(() => changeStaffRole({ userId: member.user_id, role: r, grant: !has }))}
                    >
                      {r}
                    </Button>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending || member.user_id === currentUserId}
                  onClick={() => run(() => forceSignOut({ userId: member.user_id }))}
                >
                  <LogOut aria-hidden="true" /> Force sign-out
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
