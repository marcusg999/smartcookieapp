import { TaxonomyEditor } from "@/components/admin/menu/taxonomy-editor";
import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (
    await createClient()
  )
    .from("menu_categories")
    .select("id, name, is_active")
    .order("sort_order");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Categories"
        description="Group meals on the menu (Mains, Sides, Snacks…). The order here is the order families see."
      />
      <TaxonomyEditor
        kind="categories"
        noun="Category"
        rows={(data ?? []).map((r) => ({ id: r.id, name: r.name, is_active: r.is_active }))}
      />
    </div>
  );
}
