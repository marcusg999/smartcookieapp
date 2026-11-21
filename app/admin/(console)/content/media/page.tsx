import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { MediaLibrary } from "./media-library";

export const metadata = { title: "Media" };

export default async function MediaPage() {
  await requireStaffAAL2(["owner"]);
  const supabase = await createClient();
  const { data } = await supabase.from("media").select("id, storage_path, alt_text, width, height, created_at").order("created_at", { ascending: false }).limit(200);
  const usage = await Promise.all((data ?? []).map((m) => supabase.rpc("media_usage_count", { p_path: m.storage_path }).then((r) => Number(r.data ?? 0))));
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Media library" description="Images for your pages, logo and banners. Meal photos are added on each meal." />
      <MediaLibrary items={(data ?? []).map((m, i) => ({ ...m, usage: usage[i] ?? 0 }))} />
    </div>
  );
}
