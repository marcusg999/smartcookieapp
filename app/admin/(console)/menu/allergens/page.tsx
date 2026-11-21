import { TaxonomyEditor } from "@/components/admin/menu/taxonomy-editor";
import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Allergens" };

export default async function AllergensPage() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (
    await createClient()
  )
    .from("allergens")
    .select("id, name, icon, is_top9, archived_at")
    .order("sort_order");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Allergens"
        description="The US top 9 are always on the list. Add your own (for example coconut or mustard) and they become available on every meal and child profile."
      />
      <TaxonomyEditor
        kind="allergens"
        noun="Allergen"
        rows={(data ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          icon: r.icon ?? "",
          archived: !!r.archived_at,
          locked: r.is_top9,
        }))}
      />
    </div>
  );
}
