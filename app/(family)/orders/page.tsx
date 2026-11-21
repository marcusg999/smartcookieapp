import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { getContent } from "@/lib/content/content";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const c = await getContent();
  return <PlaceholderPage title={c.text("family.orders.title")} description={c.text("family.orders.body")} />;
}
