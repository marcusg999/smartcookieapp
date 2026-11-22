import { Heart } from "lucide-react";

import { UnfavoriteButton } from "@/components/family/address-form";
import { PageTitle } from "@/components/family/kit";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getChildren, getFavorites, getHousehold, getOrderableWeeks } from "@/lib/family/queries";

export const metadata = { title: "Favorites" };

export default async function FavoritesPage() {
  await requireUser("/favorites");
  const [c, household, weeks] = await Promise.all([getContent(), getHousehold(), getOrderableWeeks()]);
  const [favorites, kids] = household
    ? await Promise.all([getFavorites(household.id), getChildren(household.id)])
    : [[], []];
  const onMenu = new Set((weeks[0]?.meals ?? []).map((m) => m.id));
  const groups = [
    ...kids.map((k) => ({ id: k.id as string | null, name: k.first_name })),
    { id: null, name: c.text("fav.household") },
  ]
    .map((g) => ({ ...g, items: favorites.filter((f) => f.childId === g.id) }))
    .filter((g) => g.items.length);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle sub={c.text("fav.subtitle")}>{c.text("fav.title")}</PageTitle>
      {groups.length === 0 ? (
        <p className="flex items-center gap-2 text-lg text-muted-foreground">
          <Heart aria-hidden="true" className="size-5" /> {c.text("fav.empty")}
        </p>
      ) : null}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.id ?? "household"} className="rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink">
            <h2 className="text-xl font-black">{g.name}</h2>
            <ul className="mt-2 divide-y divide-ink/10">
              {g.items.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="flex items-center gap-2 font-semibold">
                      <Heart aria-hidden="true" className="size-4 fill-raspberry text-raspberry" /> {f.name}
                    </span>
                    {!onMenu.has(f.menuItemId) ? (
                      <span className="text-xs text-muted-foreground">{c.text("fav.not_this_week")}</span>
                    ) : null}
                  </span>
                  <UnfavoriteButton
                    label={`${c.text("order.unfavorite")}: ${f.name}`}
                    menuItemId={f.menuItemId}
                    childId={f.childId}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
