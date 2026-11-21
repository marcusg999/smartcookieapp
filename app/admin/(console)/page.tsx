import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Dashboard" };

export default function AdminDashboardPage() {
  return (
    <PlaceholderPage
      title="Admin dashboard"
      description="This week's orders, the aggregated cook list, allergy flags, a dietary roll-up and payment status will appear here."
    />
  );
}
