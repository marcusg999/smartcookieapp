import { TaxonomyEditor } from "@/components/admin/menu/taxonomy-editor";
import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Badges" };

export default async function BadgesPage() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (
    await createClient()
  )
    .from("dietary_badges")
    .select("id, name, icon, color, archived_at")
    .order("sort_order");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Badges"
        description="Labels like Vegetarian or Kid Favorite. Add them to meals in the meal editor."
      />
      <TaxonomyEditor
        kind="badges"
        noun="Badge"
        rows={(data ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          icon: r.icon ?? "",
          color: r.color ?? "#1f3b2d",
          archived: !!r.archived_at,
        }))}
      />
    </div>
  );
}
