import { CalendarDays, HeartHandshake, School } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder homepage. Copy moves to the CMS in Phase 3.
const features = [
  {
    icon: CalendarDays,
    title: "A fresh menu every week",
    body: "Browse the rotating menu and order for each child in a few taps.",
  },
  {
    icon: HeartHandshake,
    title: "Allergies taken seriously",
    body: "Save each child's allergies once. Meals that don't fit are blocked automatically.",
  },
  {
    icon: School,
    title: "Built for schools too",
    body: "Standing classroom orders, drop-off at school and simple monthly invoicing.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:py-24">
        <p className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
          Private kids&apos; chef service
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Healthy, home-cooked meals your kids will actually eat.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Order the week&apos;s meals for every child in minutes. No more PDF forms.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/menu">See this week&apos;s menu</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/sign-up">Create a family account</Link>
          </Button>
        </div>
      </section>
      <section id="how-it-works" aria-labelledby="how-heading" className="mx-auto w-full max-w-6xl px-4 pb-16">
        <h2 id="how-heading" className="sr-only">
          How it works
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Card className="h-full">
                <CardHeader>
                  <Icon aria-hidden="true" className="size-6 text-primary" />
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{body}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <section id="schools" className="sr-only" aria-label="For schools" />
    </>
  );
}
