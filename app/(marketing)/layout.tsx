import Link from "next/link";
import { ViewTransition } from "react";

import { HalftoneDefs } from "@/components/art/cartoons";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";

// Marketing shell. Nav and footer copy are placeholders; from Phase 3 all
// public text comes from the CMS (CLAUDE.md §1, guiding principle).
const nav = [
  { href: "/menu", label: "This week's menu" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#schools", label: "For schools" },
];

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col" data-shell="marketing">
      <HalftoneDefs />
      <header className="sticky top-0 z-40 h-(--header-h) border-b-2 border-ink bg-paper">
        <div className="mx-auto flex h-[3.9rem] w-full max-w-6xl items-center justify-between gap-3 px-4">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 font-semibold underline-offset-[6px] hover:underline hover:decoration-orange hover:decoration-[3px]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Get started</Link>
            </Button>
          </div>
        </div>
        <nav
          aria-label="Main (mobile)"
          className="flex h-[2.4rem] items-center gap-4 overflow-x-auto border-t-2 border-ink px-4 text-sm font-semibold md:hidden"
        >
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 rounded-sm">
              {item.label}
            </Link>
          ))}
          <Link href="/sign-in" className="shrink-0 rounded-sm sm:hidden">
            Sign in
          </Link>
        </nav>
      </header>
      <ViewTransition enter="page-in" exit="page-out" default="none">
        <main id="main" className="flex-1">
          {children}
        </main>
      </ViewTransition>
      <footer className="border-t-2 border-ink bg-ink text-paper">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-12">
          <p className="font-display text-3xl leading-tight italic sm:col-span-5">Smart Cookie</p>
          <div className="space-y-2 text-sm text-paper/85 sm:col-span-7">
            <p>Healthy, home-cooked meals for kids. Made fresh every week.</p>
            <p>
              Allergen information is listed on every meal. We take allergies seriously, but our kitchen handles common
              allergens, so we never promise &ldquo;allergen-free&rdquo;.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
