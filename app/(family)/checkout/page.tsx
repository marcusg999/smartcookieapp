import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { getContent } from "@/lib/content/content";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const c = await getContent();
  return <PlaceholderPage title={c.text("family.checkout.title")} description={c.text("family.checkout.body")} />;
}
