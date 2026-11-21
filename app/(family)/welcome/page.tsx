import { PageTitle } from "@/components/family/kit";
import { Onboarding } from "@/components/family/onboarding";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { describePlan } from "@/lib/family/plan-copy";
import {
  getAddresses,
  getAllergens,
  getChildren,
  getDietaryBadges,
  getHousehold,
  getPartnerSchools,
  getPlans,
  getProfile,
} from "@/lib/family/queries";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const user = await requireUser("/welcome");
  const [c, household] = await Promise.all([getContent(), getHousehold()]);
  if (!household) return null;
  const [kids, addresses, allergens, badges, schools, plans, profile] = await Promise.all([
    getChildren(household.id),
    getAddresses(household.id),
    getAllergens(),
    getDietaryBadges(),
    getPartnerSchools(),
    getPlans(),
    getProfile(user.id),
  ]);
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageTitle sub={c.text("onb.subtitle")}>{c.text("onb.title")}</PageTitle>
      <Onboarding
        copy={c.group("onb.")}
        kidsCopy={c.group("kids.")}
        household={{
          name: household.name,
          phone: profile?.phone ?? "",
          preference: household.ordering_preference,
          planId: household.preferred_plan_id,
        }}
        hasAddress={addresses.length > 0}
        kids={kids}
        allergens={allergens}
        badges={badges}
        schools={schools}
        plans={plans.map((p) => describePlan(p, c))}
      />
    </div>
  );
}
