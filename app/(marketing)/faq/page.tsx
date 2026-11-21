import type { Metadata } from "next";

import { RichText } from "@/components/rich-text";
import { getContent } from "@/lib/content/content";
import { getPublishedFaqs } from "@/lib/content/public-data";
import { getPublicSettings } from "@/lib/content/settings";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getContent();
  return { title: c.text("faq.title"), description: c.text("seo.faq_description") };
}

export default async function FaqPage() {
  const [c, faqs, settings] = await Promise.all([getContent(), getPublishedFaqs().catch(() => []), getPublicSettings().catch(() => null)]);
  const groups = [...new Set(faqs.map((f) => f.category ?? ""))];
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-14 md:py-20">
      <h1 className="text-5xl leading-[0.95] font-black md:text-7xl">{c.text("faq.title")}</h1>
      <p className="mt-4 max-w-2xl text-lg">
        {c.text("faq.subtitle")}{" "}
        {settings?.contact_email ? (
          <a className="font-semibold underline decoration-orange decoration-[3px] underline-offset-4" href={`mailto:${settings.contact_email}`}>
            {settings.contact_email}
          </a>
        ) : null}
      </p>
      {faqs.length === 0 ? <p className="mt-10">{c.text("faq.empty")}</p> : null}
      {groups.map((g) => (
        <section key={g || "general"} className="mt-12">
          {g ? <h2 className="mb-4 text-3xl font-black capitalize">{g}</h2> : null}
          <div className="space-y-3">
            {faqs
              .filter((f) => (f.category ?? "") === g)
              .map((f) => (
                <details key={f.id} className="group reveal-up rounded-2xl border-2 border-ink bg-paper p-5 shadow-ink-sm open:shadow-ink">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold">
                    {f.question}
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink bg-orange text-xl transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <RichText doc={f.answer_rich} className="mt-3 leading-relaxed" />
                </details>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
