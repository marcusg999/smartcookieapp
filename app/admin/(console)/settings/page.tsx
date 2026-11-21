import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { requireStaffAAL2 } from "@/lib/auth/guards";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireStaffAAL2(["owner"]);
  return <PlaceholderPage title="Settings" description="Business settings, delivery zones, cutoffs and branding." />;
}
