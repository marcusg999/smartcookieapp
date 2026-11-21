import { ArrowRight, Check, Quote, ShieldCheck, Sparkles } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { Broccoli, CookieMascot, Wrap } from "@/components/art/cartoons";
import { ShaderField } from "@/components/art/shader-field";
import { PackTheTrayHero } from "@/components/marketing/pack-the-tray-hero";
import { MealImage } from "@/components/menu/meal-image";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/rich-text";
import { getContent } from "@/lib/content/content";
import { getPublicSettings } from "@/lib/content/settings";
import { publicEnv } from "@/lib/env.public";
import { createPublicClient } from "@/lib/supabase/public";
import { getPublicPlans, getPublishedFaqs, getPublishedTestimonials } from "@/lib/content/public-data";
import { describePlan } from "@/lib/family/plan-copy";
import { stepsSchema } from "@/lib/content/schemas";
import { getPublishedWeeks } from "@/lib/menu/queries";

// Every word on this page comes from the CMS (content_blocks), edited in
// /admin/content. Layout and illustrations stay in code.
const TILTS = [-3, 2, -1.5, 3, -2];
const OFFSETS = ["md:mt-10", "md:-mt-4", "md:mt-16", "md:mt-2", "md:mt-12"];
const PANELS = [
  { art: CookieMascot, panel: "bg-orange text-ink md:col-span-4 md:-rotate-[1.5deg]", bubbleClass: "bg-paper" },
  { art: Wrap, panel: "bg-paper text-ink md:col-span-4 md:mt-20 md:rotate-1", bubbleClass: "bg-orange-tint" },
  { art: Broccoli, panel: "bg-ink text-paper md:col-span-4 md:mt-8 md:-rotate-1", bubbleClass: "bg-paper text-ink" },
];

export default async function HomePage() {
  const [c, weeks, plans, faqs, testimonials, settings, nonce, zones] = await Promise.all([
    getContent(),
    getPublishedWeeks().catch(() => []),
    getPublicPlans().catch(() => []),
    getPublishedFaqs().catch(() => []),
    getPublishedTestimonials().catch(() => []),
    getPublicSettings().catch(() => null),
    headers().then((h) => h.get("x-nonce") ?? undefined),
    createPublicClient()
      .from("delivery_zones")
      .select("name")
      .then((r) => (r.data ?? []).map((z) => z.name as string)),
  ]);
  // Structured data for search (LocalBusiness). "<" is escaped so the JSON
  // can never close the script tag.
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: settings?.business_name ?? "Smart Cookie",
    description: c.text("seo.site_description"),
    url: publicEnv.NEXT_PUBLIC_SITE_URL,
    ...(settings?.contact_email ? { email: settings.contact_email } : {}),
    ...(settings?.contact_phone ? { telephone: settings.contact_phone } : {}),
    ...(zones.length ? { areaServed: zones.map((name) => ({ "@type": "Place", name })) } : {}),
    sameAs: Object.values(settings?.social_links ?? {}).filter(
      (u) => typeof u === "string" && u.startsWith("https://"),
    ),
  }).replace(/</g, "\\u003c");
  const marquee = c
    .text("home.marquee")
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
  const planCards = plans.slice(0, 3).map((p) => describePlan(p, c));
  const plansCta = c.cta("home.plans.cta");
  const faqCta = c.cta("home.faq.cta");
  const finalCta = c.cta("home.cta.button");
  const parsedSteps = stepsSchema.safeParse(c.json("how_it_works.steps", []));
  const steps = parsedSteps.success ? parsedSteps.data.slice(0, 3) : [];
  const meals = (weeks[0]?.meals ?? []).filter((m) => m.available_for !== "schools").slice(0, 5);
  const heroCta = c.cta("home.hero.cta");
  const heroCta2 = c.cta("home.hero.cta_secondary");
  const schoolsCta = c.cta("home.schools.cta");

  return (
    <>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <PackTheTrayHero
        copy={{
          caption: c.text("home.hero.caption"),
          captionDone: c.text("home.hero.caption_done"),
          stamp: c.text("home.hero.stamp"),
          scrollHint: c.text("home.hero.scroll_hint"),
        }}
      >
        <p className="mb-4 inline-flex rotate-[-2deg] items-center rounded-md border-2 border-ink bg-paper px-3 py-1 text-xs font-bold tracking-wide uppercase shadow-ink-sm sm:mb-5 sm:text-sm">
          {c.text("home.hero.eyebrow")}
        </p>
        <h1 id="hero-title" className="text-[clamp(2.9rem,9vw,6.4rem)] leading-[0.92] font-black tracking-tight">
          {c.text("home.hero.title")}{" "}
          <span className="relative inline-block italic">
            <span
              className="absolute inset-x-[-0.08em] inset-y-[0.12em] -z-0 -rotate-2 rounded-md border-2 border-ink bg-orange"
              aria-hidden="true"
            />
            <span className="relative">{c.text("home.hero.title_highlight")}</span>
          </span>
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed sm:mt-6 sm:text-xl">{c.text("home.hero.subtitle")}</p>
        <div className="mt-5 flex flex-wrap gap-3 sm:mt-8">
          {heroCta.label ? (
            <Button asChild size="lg">
              <Link href={heroCta.href}>
                {heroCta.label} <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          {heroCta2.label ? (
            <Button asChild size="lg" variant="outline" className="hidden sm:inline-flex">
              <Link href={heroCta2.href}>{heroCta2.label}</Link>
            </Button>
          ) : null}
        </div>
      </PackTheTrayHero>

      {marquee.length ? (
        <div className="marquee relative -rotate-1 overflow-hidden border-y-2 border-ink bg-orange py-3 shadow-ink">
          <p className="sr-only">{c.text("home.marquee")}</p>
          <div
            className="marquee-track flex w-max gap-8 pr-8 text-lg font-black whitespace-nowrap uppercase"
            aria-hidden="true"
          >
            {[...marquee, ...marquee].map((item, i) => (
              <span key={i} className="flex items-center gap-8">
                {item} <Sparkles className="size-5" />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {meals.length ? (
        <section aria-labelledby="week-heading" className="relative mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
          <div className="grid grid-cols-12 items-end gap-4">
            <h2 id="week-heading" className="col-span-12 text-5xl leading-none font-black md:col-span-7 md:text-7xl">
              {c.text("home.week.title")}
            </h2>
            <p className="col-span-12 text-lg md:col-span-4 md:col-start-9 md:pb-2">{c.text("home.week.subtitle")}</p>
          </div>
          <ul className="mt-12 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-5 md:gap-x-5">
            {meals.map((meal, i) => (
              <li
                key={meal.id}
                className={`${OFFSETS[i]} last:odd:col-span-2 last:odd:mx-auto last:odd:w-1/2 sm:last:odd:col-span-1 sm:last:odd:w-auto`}
              >
                <Link
                  href="/menu"
                  style={{ rotate: `${TILTS[i]}deg` }}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border-2 border-ink bg-paper shadow-ink transition-[translate,box-shadow,rotate] duration-200 hover:-translate-y-1 hover:rotate-0 hover:shadow-ink-lg focus-visible:rotate-0"
                >
                  <MealImage
                    path={meal.image?.path}
                    alt=""
                    className="aspect-square"
                    sizes="(min-width: 768px) 220px, 50vw"
                  />
                  <p className="border-t-2 border-ink px-3 py-2 text-sm leading-tight font-semibold">{meal.name}</p>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-center">
            <Button asChild variant="outline" size="lg">
              <Link href="/menu">
                {c.text("home.week.cta")} <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </p>
        </section>
      ) : null}

      <section id="how-it-works" aria-labelledby="how-heading" className="border-y-2 border-ink bg-paper">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
          <h2 id="how-heading" className="max-w-2xl text-5xl leading-none font-black md:text-7xl">
            {c.text("how_it_works.title")}
          </h2>
          <ol className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-x-6">
            {steps.map((step, i) => {
              const { art: Art, panel, bubbleClass } = PANELS[i]!;
              return (
                <li
                  key={i}
                  className={`relative flex flex-col rounded-2xl border-2 border-ink p-6 shadow-ink-lg ${panel}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span aria-hidden="true" className="font-display text-8xl leading-[0.7] font-black italic">
                      {i + 1}
                    </span>
                    {step.bubble ? (
                      <p
                        aria-hidden="true"
                        className={`relative mt-1 max-w-[11rem] rotate-2 rounded-2xl border-2 border-ink px-3 py-2 text-sm leading-snug font-bold ${bubbleClass}`}
                      >
                        {step.bubble}
                        <span className="absolute -bottom-[9px] left-6 size-4 rotate-45 border-r-2 border-b-2 border-ink bg-inherit" />
                      </p>
                    ) : null}
                  </div>
                  <div className="my-6 flex h-28 items-center justify-center">
                    <Art className="h-full w-auto" />
                  </div>
                  <h3 className="text-2xl leading-tight font-bold text-inherit">{step.title}</h3>
                  <p className="mt-2 text-[1.05rem] leading-relaxed">{step.body}</p>
                </li>
              );
            })}
          </ol>

          <div className="mt-16 grid grid-cols-12 md:mt-20">
            <div className="col-span-12 flex items-start gap-4 rounded-2xl border-2 border-ink bg-ink p-6 text-paper shadow-[8px_8px_0_0_var(--orange)] md:col-span-8 md:col-start-4">
              <ShieldCheck aria-hidden="true" className="mt-1 size-8 shrink-0 text-orange" />
              <div>
                <h3 className="text-2xl font-bold text-paper">{c.text("home.allergy.title")}</h3>
                <p className="mt-2 leading-relaxed text-paper/90">{c.text("home.allergy.body")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {planCards.length ? (
        <section aria-labelledby="plans-heading" className="mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
          <div className="grid grid-cols-12 items-end gap-4">
            <h2 id="plans-heading" className="col-span-12 text-5xl leading-none font-black md:col-span-7 md:text-7xl">
              {c.text("home.plans.title")}
            </h2>
            <p className="col-span-12 text-lg md:col-span-4 md:col-start-9 md:pb-2">{c.text("home.plans.subtitle")}</p>
          </div>
          <ul className="mt-12 grid gap-6 md:grid-cols-4">
            <li
              style={{ "--tilt": "-1.5deg" } as React.CSSProperties}
              className="reveal-up flex flex-col rounded-2xl border-2 border-dashed border-ink bg-paper p-6"
            >
              <h3 className="text-2xl font-black">{c.text("home.plans.a_la_carte_title")}</h3>
              <p className="mt-3 flex-1 leading-relaxed">{c.text("home.plans.a_la_carte_body")}</p>
            </li>
            {planCards.map((p, i) => (
              <li
                key={p.id}
                style={{ "--tilt": `${[1.2, -0.8, 1.6][i]}deg` } as React.CSSProperties}
                className={`reveal-up flex flex-col rounded-2xl border-2 border-ink p-6 shadow-ink-lg ${i === 1 ? "bg-orange" : "bg-paper"}`}
              >
                <h3 className="text-xl leading-tight font-black">{p.name}</h3>
                <p className="mt-3 font-display text-5xl font-black italic">{p.priceLabel}</p>
                <p className="text-sm font-semibold">{p.intervalLabel}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {p.points.slice(0, 3).map((pt) => (
                    <li key={pt} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {pt}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {plansCta.label ? (
            <p className="mt-10 text-center">
              <Button asChild size="lg">
                <Link href={plansCta.href}>
                  {plansCta.label} <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </p>
          ) : null}
        </section>
      ) : null}

      {testimonials.length ? (
        <section aria-labelledby="love-heading" className="border-y-2 border-ink bg-orange-tint py-20 md:py-24">
          <h2 id="love-heading" className="mx-auto max-w-6xl px-4 text-5xl leading-none font-black md:text-7xl">
            {c.text("home.testimonials.title")}
          </h2>
          <ul
            className="mx-auto mt-10 flex max-w-6xl snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-6"
            tabIndex={0}
          >
            {testimonials.map((t, i) => (
              <li
                key={t.id}
                style={{ "--tilt": `${i % 2 ? 1.5 : -1.5}deg` } as React.CSSProperties}
                className="reveal-up w-[85%] shrink-0 snap-center rounded-3xl border-2 border-ink bg-paper p-6 shadow-ink-lg sm:w-[26rem]"
              >
                <Quote aria-hidden="true" className="size-8 text-raspberry" />
                <blockquote className="mt-3 font-display text-2xl leading-snug italic">{t.quote}</blockquote>
                {t.attribution ? <p className="mt-4 font-bold">{t.attribution}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section id="schools" aria-labelledby="schools-heading" className="relative overflow-hidden bg-ink text-paper">
        <ShaderField
          intensity={0.6}
          transparent
          className="[mask-image:radial-gradient(circle_at_100%_100%,black_15%,transparent_55%)] md:[mask-image:linear-gradient(to_right,transparent_50%,black_80%)]"
        />
        <div className="relative mx-auto grid w-full max-w-6xl grid-cols-12 gap-6 px-4 py-20 md:py-28">
          <h2
            id="schools-heading"
            className="col-span-12 text-5xl leading-none font-black text-paper md:col-span-6 md:text-7xl"
          >
            {c.text("home.schools.title")}{" "}
            <span className="text-orange italic">{c.text("home.schools.title_highlight")}</span>
          </h2>
          <div className="col-span-12 space-y-5 md:col-span-5 md:col-start-8 md:mt-24">
            <p className="text-lg leading-relaxed text-paper/90">{c.text("home.schools.body")}</p>
            {schoolsCta.label ? (
              <Button asChild size="lg">
                <Link href={schoolsCta.href}>{schoolsCta.label}</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {faqs.length ? (
        <section aria-labelledby="faq-heading" className="mx-auto w-full max-w-4xl px-4 py-20 md:py-28">
          <h2 id="faq-heading" className="text-5xl leading-none font-black md:text-7xl">
            {c.text("home.faq.title")}
          </h2>
          <div className="mt-10 space-y-3">
            {faqs.slice(0, 4).map((f) => (
              <details
                key={f.id}
                className="group reveal-up rounded-2xl border-2 border-ink bg-paper p-5 shadow-ink-sm open:shadow-ink"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold">
                  {f.question}
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink bg-orange text-xl transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <RichText doc={f.answer_rich} className="mt-3 leading-relaxed" />
              </details>
            ))}
          </div>
          {faqCta.label ? (
            <p className="mt-8">
              <Button asChild variant="outline" size="lg">
                <Link href={faqCta.href}>{faqCta.label}</Link>
              </Button>
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="cta-heading" className="relative overflow-hidden border-t-2 border-ink bg-orange">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-20 md:grid-cols-12 md:py-24">
          <div className="md:col-span-8">
            <h2 id="cta-heading" className="text-5xl leading-[0.95] font-black md:text-7xl">
              {c.text("home.cta.title")}
            </h2>
            <p className="mt-4 max-w-xl text-lg">{c.text("home.cta.body")}</p>
            {finalCta.label ? (
              <Button asChild size="lg" variant="secondary" className="mt-6">
                <Link href={finalCta.href}>
                  {finalCta.label} <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </div>
          <div className="float-y hidden justify-center md:col-span-4 md:flex">
            <CookieMascot className="h-48 w-auto -rotate-6" />
          </div>
        </div>
      </section>
    </>
  );
}
