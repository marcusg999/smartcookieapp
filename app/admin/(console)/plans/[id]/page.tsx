import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { countActiveSubscribers } from "@/lib/admin/plans";

import type { PlanInput } from "../actions";
import { PlanBuilder } from "./plan-builder";

export const metadata = { title: "Plan builder" };

export default async function PlanPage({ params }: PageProps<"/admin/plans/[id]">) {
  await requireStaffAAL2(["owner"]);
  const { id } = await params;
  const isNew = id === "new";
  let plan: PlanInput & { id?: string } = {
    name: "",
    audience: "family",
    billing_interval: "week",
    meals_per_interval: 3,
    allowance_unit: "per_child",
    price_cents: 2500,
    price_per_extra_meal_cents: null,
    includes_snacks: false,
    snacks_per_interval: 0,
    allow_skip: true,
    max_skips_per_month: 2,
    allow_pause: true,
    rollover_unused: false,
    max_rollover: 0,
    auto_fill_strategy: "favorites",
    min_commitment_intervals: 0,
    trial_intervals: 0,
    is_active: true,
  };
  let subscribers = 0;
  if (!isNew) {
    const { data } = await (await createClient()).from("plans").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    const { slug: _s, created_at: _c, updated_at: _u, archived_at: _a, stripe_product_id: _p, stripe_price_id: _sp, currency: _cur, sort_order: _o, ...rest } = data;
    plan = { ...rest, description_rich: rest.description_rich ?? undefined } as typeof plan;
    subscribers = await countActiveSubscribers(id);
  }
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title={isNew ? "New plan" : plan.name} description="Answer the questions; the preview on the right shows what customers will see. Saving asks for your authenticator code." />
      <PlanBuilder plan={plan} subscribers={subscribers} />
    </div>
  );
}
