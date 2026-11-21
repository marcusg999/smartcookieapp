import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { requireStaffAAL2 } from "@/lib/auth/guards";

export const metadata = { title: "Content" };

export default async function AdminContentPage() {
  await requireStaffAAL2(["owner"]);
  return <PlaceholderPage title="Content" description="Site text, FAQs, policies and email copy." />;
}
