import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { getContent } from "@/lib/content/content";

export const metadata = { title: "Cart" };

export default async function CartPage() {
  const c = await getContent();
  return <PlaceholderPage title={c.text("family.cart.title")} description={c.text("family.cart.body")} />;
}
