import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { DiscountsEditor } from "./discounts-editor";

export const metadata = { title: "Discounts" };

export default async function DiscountsPage() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (await createClient()).from("discount_codes").select("id, code, type, value, max_redemptions, times_redeemed, expires_at, is_active").order("created_at", { ascending: false });
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="Discounts" description="Promo codes families can enter at checkout. Changing an amount asks for your authenticator code." />
      <DiscountsEditor codes={data ?? []} />
    </div>
  );
}
