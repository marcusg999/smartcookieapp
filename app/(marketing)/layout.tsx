import Link from "next/link";

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
      <header className="border-b bg-background/95">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-6 text-sm font-medium md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-sm hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Get started</Link>
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t bg-secondary/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <p>© Smart Cookie. Healthy, home-cooked meals for kids.</p>
          <p>Allergen information is listed on every meal. We never promise &ldquo;allergen-free&rdquo;.</p>
        </div>
      </footer>
    </div>
  );
}
