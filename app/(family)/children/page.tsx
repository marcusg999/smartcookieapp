import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { getContent } from "@/lib/content/content";

export const metadata = { title: "Children" };

export default async function ChildrenPage() {
  const c = await getContent();
  return <PlaceholderPage title={c.text("family.children.title")} description={c.text("family.children.body")} />;
}
