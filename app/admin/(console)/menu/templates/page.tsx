import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { TemplatesManager } from "./templates-manager";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  await requireStaffAAL2(["owner"]);
  const supabase = await createClient();
  const [{ data: templates }, { data: settings }] = await Promise.all([
    supabase
      .from("menu_templates")
      .select("id, name, description, rotation_position, menu_template_items(count)")
      .is("archived_at", null)
      .order("name"),
    supabase.from("site_settings").select("rotation_anchor_week, rotation_weeks_ahead").eq("id", true).single(),
  ]);
  type Row = {
    id: string;
    name: string;
    description: string | null;
    rotation_position: number | null;
    menu_template_items: { count: number }[];
  };
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Templates & rotation"
        description="Templates are saved week layouts. Put them in a rotation (Week A → B → C…) and draft weeks are created automatically ahead of time for you to review and publish."
      />
      <TemplatesManager
        templates={((templates ?? []) as unknown as Row[]).map((t) => ({
          ...t,
          count: t.menu_template_items[0]?.count ?? 0,
        }))}
        anchorWeek={settings?.rotation_anchor_week ?? null}
        weeksAhead={settings?.rotation_weeks_ahead ?? 3}
      />
    </div>
  );
}
