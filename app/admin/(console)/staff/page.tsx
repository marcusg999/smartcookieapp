import { StepUpProvider } from "@/components/mfa/step-up";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { StaffManager, type StaffRow } from "./staff-manager";

export const metadata = { title: "Staff" };

export default async function AdminStaffPage() {
  const user = await requireStaffAAL2(["owner"]);
  const supabase = await createClient();
  const [{ data: staff }, { data: factors }] = await Promise.all([
    supabase.rpc("admin_list_staff"),
    supabase.auth.mfa.listFactors(),
  ]);
  const factorId = factors?.totp.find((f) => f.status === "verified")?.id ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Staff</h1>
        <p className="text-muted-foreground">
          Invite staff, change roles and sign people out. Every change needs a fresh authenticator code and is recorded
          in the audit log.
        </p>
      </div>
      <StepUpProvider factorId={factorId}>
        <StaffManager staff={(staff ?? []) as StaffRow[]} currentUserId={user.id} />
      </StepUpProvider>
    </div>
  );
}
