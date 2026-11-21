import { PageHeader } from "@/components/admin/page-header";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

import { TestimonialEditor } from "./testimonial-editor";

export const metadata = { title: "Testimonials" };

export default async function TestimonialsPage() {
  await requireStaffAAL2(["owner"]);
  const { data } = await (
    await createClient()
  )
    .from("testimonials")
    .select("id, quote, attribution, is_published")
    .order("sort_order");
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Testimonials"
        description="Kind words from families and schools. Only use quotes you have permission to share."
      />
      <TestimonialEditor rows={data ?? []} />
    </div>
  );
}
