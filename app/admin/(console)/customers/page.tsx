import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { requireStaffAAL2 } from "@/lib/auth/guards";

export const metadata = { title: "Customers" };

export default async function AdminCustomersPage() {
  await requireStaffAAL2(["ops", "owner"]);
  return <PlaceholderPage title="Customers" description="Families, children and their order history." />;
}
