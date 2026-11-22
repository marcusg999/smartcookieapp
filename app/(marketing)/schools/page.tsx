import { Building2, ClipboardList, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Broccoli, Wrap } from "@/components/art/cartoons";
import { Button } from "@/components/ui/button";
import { getContent } from "@/lib/content/content";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getContent();
  return { title: c.text("nav.schools"), description: c.text("seo.schools_description") };
}

const ICONS = [ClipboardList, Building2, Receipt];

export default async function SchoolsPage() {
  const c = await getContent();
  const cta = c.cta("schools.cta");
  const points = [1, 2, 3].map((n) => ({
    title: c.text(`schools.point${n}_title`),
    body: c.text(`schools.point${n}_body`),
  }));
  return (
    <>
      <section className="relative overflow-hidden bg-ink text-paper">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-12 items-center gap-6 px-4 py-20 md:py-28">
          <div className="col-span-12 md:col-span-7">
            <h1 className="text-5xl leading-[0.95] font-black text-paper md:text-7xl">{c.text("schools.title")}</h1>
            <p className="mt-5 max-w-xl text-lg text-paper/90">{c.text("schools.subtitle")}</p>
            {cta.label ? (
              <Button asChild size="lg" className="mt-8">
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
            ) : null}
          </div>
          <div className="col-span-12 hidden justify-center gap-4 md:col-span-5 md:flex">
            <Wrap className="float-y h-40 w-auto rotate-6" />
            <Broccoli className="float-y h-36 w-auto -rotate-6 [animation-delay:1.2s]" />
          </div>
        </div>
      </section>
      <section className="mx-auto w-full max-w-6xl px-4 py-20">
        <ul className="grid gap-6 md:grid-cols-3">
          {points.map((p, i) => {
            const Icon = ICONS[i]!;
            return (
              <li
                key={p.title}
                style={{ "--tilt": `${[-1.4, 1, -0.6][i]}deg` } as React.CSSProperties}
                className={`reveal-up rounded-3xl border-2 border-ink p-6 shadow-ink-lg ${i === 1 ? "bg-orange" : "bg-paper"}`}
              >
                <Icon aria-hidden="true" className="size-10" />
                <h2 className="mt-4 text-2xl font-black">{p.title}</h2>
                <p className="mt-2 leading-relaxed">{p.body}</p>
              </li>
            );
          })}
        </ul>
        <div className="mt-14 flex justify-center gap-3">
          {cta.label ? (
            <Button asChild size="lg">
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          ) : null}
          <Button asChild size="lg" variant="outline">
            <Link href="/faq">{c.text("nav.faq")}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
