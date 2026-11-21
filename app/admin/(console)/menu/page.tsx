import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { requireStaffAAL2 } from "@/lib/auth/guards";

export const metadata = { title: "Menu" };

export default async function AdminMenuPage() {
  await requireStaffAAL2(["owner"]);
  return <PlaceholderPage title="Menu" description="Meals, images, prices, allergens and the weekly rotation." />;
}
