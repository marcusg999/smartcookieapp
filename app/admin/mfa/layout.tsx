import { Logo } from "@/components/layout/logo";
import { requireRole } from "@/lib/auth/guards";

/** MFA pages: staff only (404 otherwise), reachable at AAL1. */
export default async function AdminMfaLayout({ children }: LayoutProps<"/admin/mfa">) {
  await requireRole(["kitchen", "ops", "owner"]);
  return (
    <div className="flex min-h-full flex-1 flex-col items-center px-4 py-10">
      <Logo className="mb-8" href="/admin/mfa/challenge" />
      <main id="main" className="w-full max-w-md">
        {children}
      </main>
    </div>
  );
}
