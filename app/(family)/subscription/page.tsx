import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { getContent } from "@/lib/content/content";

export const metadata = { title: "Subscription" };

export default async function SubscriptionPage() {
  const c = await getContent();
  return (
    <PlaceholderPage title={c.text("family.subscription.title")} description={c.text("family.subscription.body")} />
  );
}
