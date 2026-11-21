import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { loadCatalog } from "@/lib/admin/catalog";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Edit template" };

export default async function TemplatePage({ params }: PageProps<"/admin/menu/templates/[id]">) {
  await requireStaffAAL2(["owner"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: tpl }, { data: items }, catalog] = await Promise.all([
    supabase.from("menu_templates").select("id, name, description").eq("id", id).maybeSingle(),
    supabase
      .from("menu_template_items")
      .select("menu_item_id, price_override_cents, capacity, available_for")
      .eq("menu_template_id", id)
      .order("sort_order"),
    loadCatalog(),
  ]);
  if (!tpl) notFound();
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title={tpl.name}
        description="Changes apply to weeks created from this template from now on. Existing weeks keep their meals."
      />
      <TemplateEditor
        template={{ id: tpl.id, name: tpl.name, description: tpl.description ?? "" }}
        items={(items ?? []) as never}
        catalog={catalog}
      />
    </div>
  );
}
