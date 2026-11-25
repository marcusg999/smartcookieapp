"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";

import { inviteStaff, removeStaff } from "@/app/(school)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Field, Panel, StatusTag, useRun, type Copy } from "./kit";

export function StaffManager({
  copy,
  members,
  canInvite,
}: {
  copy: Copy;
  members: { user_id: string; role: string; email: string; full_name: string | null }[];
  canInvite: boolean;
}) {
  const [email, setEmail] = useState("");
  const { pending, run } = useRun(copy);
  return (
    <div className="space-y-6">
      {canInvite ? (
        <Panel>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => inviteStaff({ email }),
                copy["staff.invited"],
                (r) => r.ok && setEmail(""),
              );
            }}
          >
            <Field id="staff-email" label={copy["staff.email"]} className="min-w-64 flex-1">
              <Input
                id="staff-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" disabled={pending}>
              <UserPlus aria-hidden="true" /> {copy["staff.invite"]}
            </Button>
          </form>
          <p className="mt-2 text-sm text-muted-foreground">{copy["staff.help"]}</p>
        </Panel>
      ) : (
        <p className="text-muted-foreground">{copy["staff.approval_needed"]}</p>
      )}
      <ul className="divide-y-2 divide-ink/10 rounded-2xl border-2 border-ink bg-paper">
        {members.map((m) => (
          <li key={`${m.user_id}-${m.role}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span>
              <span className="font-semibold">{m.full_name || m.email}</span>
              {m.full_name ? <span className="text-sm text-muted-foreground"> · {m.email}</span> : null}
            </span>
            <span className="flex items-center gap-2">
              <StatusTag tone={m.role === "school_admin" ? "warn" : "ok"}>{copy[`staff.role_${m.role}`]}</StatusTag>
              {m.role === "school_staff" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    window.confirm(copy["staff.remove_confirm"]) &&
                    run(() => removeStaff({ user_id: m.user_id }), copy["staff.removed"])
                  }
                >
                  {copy["staff.remove"]}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
