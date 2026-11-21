import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { EMAIL_VARIABLES } from "@/lib/email/templates";
import { createClient } from "@/lib/supabase/server";
import type { RichNode } from "@/lib/validation/rich-text";

import { EmailEditor } from "./email-editor";

export const metadata = { title: "Edit email" };

export default async function EmailPage({ params }: PageProps<"/admin/content/emails/[key]">) {
  await requireStaffAAL2(["owner"]);
  const { key } = await params;
  const { data } = await (await createClient()).from("email_templates").select("key, subject, preheader, body_rich, is_active").eq("key", key).maybeSingle();
  if (!data) notFound();
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title={data.key.replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase())} description="Use the variable buttons to insert details like the order number. The preview uses sample values." />
      <EmailEditor
        template={{ key: data.key, subject: data.subject, preheader: data.preheader ?? "", body: data.body_rich as RichNode, is_active: data.is_active }}
        variables={Object.entries(EMAIL_VARIABLES).map(([name, v]) => ({ name, label: v.label }))}
      />
    </div>
  );
}
