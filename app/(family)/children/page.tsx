import { ChildrenManager } from "@/components/family/children-manager";
import { PageTitle } from "@/components/family/kit";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getAllergens, getChildren, getDietaryBadges, getHousehold, getPartnerSchools } from "@/lib/family/queries";

export const metadata = { title: "Kids" };

export default async function ChildrenPage() {
  await requireUser("/children");
  const household = await getHousehold();
  const [c, kids, allergens, badges, schools] = await Promise.all([
    getContent(),
    household ? getChildren(household.id) : [],
    getAllergens(),
    getDietaryBadges(),
    getPartnerSchools(),
  ]);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle sub={c.text("kids.subtitle")}>{c.text("kids.title")}</PageTitle>
      <ChildrenManager copy={c.group("kids.")} kids={kids} allergens={allergens} badges={badges} schools={schools} />
    </div>
  );
}
