import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { PageEditor } from "./page-editor";

export const metadata = { title: "Edit page" };

export default async function EditPage({ params }: PageProps<"/admin/content/pages/[id]">) {
  await requireStaffAAL2(["owner"]);
  const { id } = await params;
  const isNew = id === "new";
  const page = isNew ? null : (await (await createClient()).from("pages").select("*").eq("id", id).maybeSingle()).data;
  if (!isNew && !page) notFound();
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title={page?.title ?? "New page"} />
      <PageEditor
        page={{
          id: page?.id,
          title: page?.title ?? "",
          slug: page?.slug ?? "",
          seo_title: page?.seo_title ?? "",
          seo_description: page?.seo_description ?? "",
          og_image: page?.og_image ?? "",
          body: page?.body_draft ?? null,
          is_published: page?.is_published ?? false,
        }}
      />
    </div>
  );
}
