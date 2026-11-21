import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function countActiveSubscribers(planId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId)
    .in("status", ["active", "trialing", "past_due"]);
  return count ?? 0;
}
