import { Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RichText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { getContent } from "@/lib/content/content";
import { getPublicPlans } from "@/lib/content/public-data";
import { describePlan } from "@/lib/family/plan-copy";
import type { RichNode } from "@/lib/validation/rich-text";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getContent();
  return { title: c.text("plans.title"), description: c.text("seo.plans_description") };
}

export default async function PlansPage() {
  const [c, plans] = await Promise.all([getContent(), getPublicPlans().catch(() => [])]);
  const cards = plans.map((p) => ({ plan: p, ...describePlan(p, c) }));
  const rows: { label: string; values: (string | boolean)[] }[] = [
    { label: c.text("plans.meals_label", { count: "" }).trim(), values: plans.map((p) => String(p.meals_per_interval)) },
    { label: c.text("plans.per_child"), values: plans.map((p) => p.allowance_unit === "per_child") },
    { label: c.text("plans.snacks_label", { count: "" }).replace("+", "").trim(), values: plans.map((p) => (p.includes_snacks ? String(p.snacks_per_interval) : false)) },
    { label: c.text("plans.pause_label"), values: plans.map((p) => p.allow_pause) },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 md:py-20">
      <div className="grid grid-cols-12 items-end gap-4">
        <h1 className="col-span-12 text-5xl leading-[0.95] font-black md:col-span-7 md:text-7xl">{c.text("plans.title")}</h1>
        <p className="col-span-12 text-lg md:col-span-5 md:pb-2">{c.text("plans.subtitle")}</p>
      </div>

      <ul className="mt-14 grid gap-6 md:grid-cols-3">
        {cards.map((p, i) => (
          <li
            key={p.id}
            style={{ "--tilt": `${[-1.2, 0.8, -0.6][i % 3]}deg` } as React.CSSProperties}
            className={`reveal-up flex flex-col rounded-3xl border-2 border-ink p-6 shadow-ink-lg ${i === 1 ? "bg-orange md:-translate-y-4" : "bg-paper"}`}
          >
            <h2 className="text-2xl leading-tight font-black">{p.name}</h2>
            <p className="mt-3 font-display text-6xl font-black italic">{p.priceLabel}</p>
            <p className="font-semibold">{p.intervalLabel}</p>
            <RichText doc={p.plan.description_rich as RichNode | null} className="mt-3" />
            <ul className="mt-4 flex-1 space-y-2">
              {p.points.map((pt) => (
                <li key={pt} className="flex gap-2">
                  <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0" /> {pt}
                </li>
              ))}
            </ul>
            <Button asChild size="lg" variant={i === 1 ? "secondary" : "default"} className="mt-6">
              <Link href={`/sign-up?plan=${p.plan.slug}`}>{c.text("plans.cta")}</Link>
            </Button>
          </li>
        ))}
      </ul>

      {plans.length > 1 ? (
        <section aria-labelledby="compare-h" className="mt-20">
          <h2 id="compare-h" className="text-4xl font-black">
            {c.text("plans.compare_title")}
          </h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border-2 border-ink bg-paper shadow-ink">
            <table className="w-full min-w-[36rem] text-left">
              <thead className="border-b-2 border-ink">
                <tr>
                  <th scope="col" className="p-3">
                    {c.text("plans.compare_feature")}
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className="p-3">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-ink/10 last:border-0">
                    <th scope="row" className="p-3 font-semibold">
                      {r.label}
                    </th>
                    {r.values.map((v, i) => (
                      <td key={i} className="p-3">
                        {v === true ? <Check aria-label="✓" className="size-5" /> : v === false ? <Minus aria-label="–" className="size-5" /> : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="mt-10 rounded-2xl border-2 border-dashed border-ink bg-paper p-5 text-lg font-semibold">
        {c.text("plans.a_la_carte_note")}{" "}
        <Link href="/menu" className="underline decoration-orange decoration-[3px] underline-offset-4">
          {c.text("nav.menu")}
        </Link>
      </p>
    </div>
  );
}
