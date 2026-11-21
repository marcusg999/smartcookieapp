import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Broccoli, CookieMascot, Wrap } from "@/components/art/cartoons";
import { ShaderField } from "@/components/art/shader-field";
import { PackTheTrayHero } from "@/components/marketing/pack-the-tray-hero";
import { DayCard } from "@/components/menu/day-card";
import { Button } from "@/components/ui/button";
import { DEMO_WEEK } from "@/lib/demo/menu";

// Placeholder copy. Moves to the CMS in Phase 3.
const TILTS = [-3, 2, -1.5, 3, -2];
const OFFSETS = ["md:mt-10", "md:-mt-4", "md:mt-16", "md:mt-2", "md:mt-12"];

// Comic panels: each a different "ink" so the strip reads left to right.
const steps = [
  {
    n: "1",
    title: "Tell us about your kids",
    body: "First names, classroom and allergies. Once. We remember them every week.",
    bubble: "Sam can't have sesame!",
    art: CookieMascot,
    panel: "bg-orange text-ink md:col-span-4 md:-rotate-[1.5deg]",
    bubbleClass: "bg-paper",
  },
  {
    n: "2",
    title: "Pick meals in a few taps",
    body: "Choose from this week's menu for each child, or reorder last week's favourites with one tap.",
    bubble: "Same as last week, please.",
    art: Wrap,
    panel: "bg-paper text-ink md:col-span-4 md:mt-20 md:rotate-1",
    bubbleClass: "bg-orange-tint",
  },
  {
    n: "3",
    title: "We cook. You relax.",
    body: "Fresh, home-cooked and labelled for each child. Delivered to your door or straight to school.",
    bubble: "Lunch is here!",
    art: Broccoli,
    panel: "bg-ink text-paper md:col-span-4 md:mt-8 md:-rotate-1",
    bubbleClass: "bg-paper text-ink",
  },
];

export default function HomePage() {
  return (
    <>
      <PackTheTrayHero>
        <p className="mb-4 inline-flex rotate-[-2deg] items-center rounded-md border-2 border-ink bg-paper px-3 py-1 text-xs font-bold tracking-wide uppercase shadow-ink-sm sm:mb-5 sm:text-sm">
          Private kids&apos; chef · families &amp; schools
        </p>
        <h1 id="hero-title" className="text-[clamp(2.9rem,9vw,6.4rem)] leading-[0.92] font-black tracking-tight">
          Lunch,{" "}
          <span className="relative inline-block italic">
            <span
              className="absolute inset-x-[-0.08em] inset-y-[0.12em] -z-0 -rotate-2 rounded-md border-2 border-ink bg-orange"
              aria-hidden="true"
            />
            <span className="relative">handled.</span>
          </span>
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed sm:mt-6 sm:text-xl">
          Healthy, home-cooked meals your kids will actually eat. Order the whole week in minutes. No more PDF forms.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 sm:mt-8">
          <Button asChild size="lg">
            <Link href="/menu">
              See this week&apos;s menu <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="hidden sm:inline-flex">
            <Link href="/sign-up">Create a family account</Link>
          </Button>
        </div>
      </PackTheTrayHero>

      <section aria-labelledby="week-heading" className="relative mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
        <div className="grid grid-cols-12 items-end gap-4">
          <h2 id="week-heading" className="col-span-12 text-5xl leading-none font-black md:col-span-7 md:text-7xl">
            This <span className="italic">week</span>
            <span className="text-muted-foreground">,</span> at a glance
          </h2>
          <p className="col-span-12 text-lg md:col-span-4 md:col-start-9 md:pb-2">
            A fresh menu every week. Tap a day to see what&apos;s cooking.
          </p>
        </div>
        <ul className="mt-12 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-5 md:gap-x-5">
          {DEMO_WEEK.map((day, i) => (
            <li
              key={day.slug}
              className={`${OFFSETS[i]} last:col-span-2 last:mx-auto last:w-1/2 sm:last:col-span-1 sm:last:w-auto`}
            >
              <DayCard day={day} href={`/menu?day=${day.slug}`} tilt={TILTS[i]} className="h-full" />
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" className="border-y-2 border-ink bg-paper">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
          <h2 id="how-heading" className="max-w-2xl text-5xl leading-none font-black md:text-7xl">
            How it <span className="italic">works</span>
          </h2>
          <ol className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-x-6">
            {steps.map(({ n, title, body, bubble, art: Art, panel, bubbleClass }) => (
              <li
                key={n}
                className={`relative flex flex-col rounded-2xl border-2 border-ink p-6 shadow-ink-lg ${panel}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span aria-hidden="true" className="font-display text-8xl leading-[0.7] font-black italic">
                    {n}
                  </span>
                  <p
                    aria-hidden="true"
                    className={`relative mt-1 max-w-[11rem] rotate-2 rounded-2xl border-2 border-ink px-3 py-2 text-sm leading-snug font-bold ${bubbleClass}`}
                  >
                    {bubble}
                    <span className="absolute -bottom-[9px] left-6 size-4 rotate-45 border-r-2 border-b-2 border-ink bg-inherit" />
                  </p>
                </div>
                <div className="my-6 flex h-28 items-center justify-center">
                  <Art className="h-full w-auto" />
                </div>
                <h3 className="text-2xl leading-tight font-bold text-inherit">
                  <span className="sr-only">Step {n}: </span>
                  {title}
                </h3>
                <p className="mt-2 text-[1.05rem] leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-16 grid grid-cols-12 md:mt-20">
            <div className="col-span-12 flex items-start gap-4 rounded-2xl border-2 border-ink bg-ink p-6 text-paper shadow-[8px_8px_0_0_var(--orange)] md:col-span-8 md:col-start-4">
              <ShieldCheck aria-hidden="true" className="mt-1 size-8 shrink-0 text-orange" />
              <div>
                <h3 className="text-2xl font-bold text-paper">Allergies are blocked, not just noted.</h3>
                <p className="mt-2 leading-relaxed text-paper/90">
                  If a meal contains something on your child&apos;s allergy list, you can&apos;t add it by mistake. At
                  checkout we ask one quick question: &ldquo;Are these still correct for each child?&rdquo;
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

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
            Feeding a <span className="text-orange italic">whole class?</span>
          </h2>
          <div className="col-span-12 space-y-5 md:col-span-5 md:col-start-8 md:mt-24">
            <p className="text-lg leading-relaxed text-paper/90">
              Standing orders sized to each classroom&apos;s headcount, drop-off at school, and one simple invoice each
              month.
            </p>
            <Button asChild size="lg">
              <Link href="/sign-up">Set up your school</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
