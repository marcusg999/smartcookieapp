import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { ZonesEditor } from "./zones-editor";

export const metadata = { title: "Delivery zones" };

export default async function ZonesPage() {
  const user = await requireStaffAAL2(["ops", "owner"]);
  const { data } = await (
    await createClient()
  )
    .from("delivery_zones")
    .select(
      "id, name, zip_codes, fee_cents, free_over_cents, min_order_cents, delivery_weekdays, delivery_window_label, is_active",
    )
    .is("archived_at", null)
    .order("sort_order");
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Delivery zones"
        description="Where you deliver, on which days, and what it costs. Families outside every zone can still choose school drop-off."
      />
      <ZonesEditor
        zones={(data ?? []).map((z) => ({
          ...z,
          zip_codes: z.zip_codes.join(", "),
          delivery_window_label: z.delivery_window_label ?? "",
        }))}
        canEditFees={user.roles.includes("owner")}
      />
    </div>
  );
}
