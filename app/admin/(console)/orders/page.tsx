import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { requireStaffAAL2 } from "@/lib/auth/guards";

export const metadata = { title: "Orders" };

export default async function AdminOrdersPage() {
  await requireStaffAAL2(["ops", "owner"]);
  return <PlaceholderPage title="Orders" description="All family and school orders for the week." />;
}
