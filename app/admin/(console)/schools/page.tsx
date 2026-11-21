import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { requireStaffAAL2 } from "@/lib/auth/guards";

export const metadata = { title: "Schools" };

export default async function AdminSchoolsPage() {
  await requireStaffAAL2(["ops", "owner"]);
  return <PlaceholderPage title="Schools" description="School organizations, classrooms and invoicing." />;
}
