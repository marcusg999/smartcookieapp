import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { RichNode } from "@/lib/validation/rich-text";

import { FaqEditor } from "./faq-editor";

export const metadata = { title: "FAQs" };

export default async function FaqsPage() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (await createClient()).from("faqs").select("id, question, answer_rich, category, is_published").order("sort_order");
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="FAQs" description="Questions and answers for families and schools. Switch each one on when it's ready." />
      <FaqEditor rows={(data ?? []).map((r) => ({ id: r.id, question: r.question, answer: r.answer_rich as RichNode, category: r.category ?? "", is_published: r.is_published }))} />
    </div>
  );
}
