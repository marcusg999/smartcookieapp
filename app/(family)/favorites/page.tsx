import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { getContent } from "@/lib/content/content";

export const metadata = { title: "Favorites" };

export default async function FavoritesPage() {
  const c = await getContent();
  return <PlaceholderPage title={c.text("family.favorites.title")} description={c.text("family.favorites.body")} />;
}
