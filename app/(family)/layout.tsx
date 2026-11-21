import { CalendarDays, ClipboardList, Heart, ShoppingBasket, User } from "lucide-react";
import { ViewTransition } from "react";

import { HalftoneDefs } from "@/components/art/cartoons";
import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";

// Family shell. Mobile-first: a bottom tab bar on phones (where most parents
// order) and a top nav on larger screens. Auth guard arrives in Phase 2.
const tabs = [
  { href: "/menu", label: "Menu", icon: CalendarDays },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/cart", label: "Cart", icon: ShoppingBasket },
  { href: "/favorites", label: "Favorites", icon: Heart },
  { href: "/account", label: "Account", icon: User },
];

export default function FamilyLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col" data-shell="family">
      <HalftoneDefs />
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Logo href="/menu" label="Family home" />
          <nav aria-label="Family" className="hidden gap-1 md:flex">
            {tabs.map(({ href, label }) => (
              <NavLink
                key={href}
                href={href}
                className="rounded-md border-2 border-transparent px-3 py-1.5 font-semibold hover:border-ink"
                activeClassName="border-ink! bg-orange shadow-ink-sm"
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <ViewTransition enter="page-in" exit="page-out" default="none">
        <main id="main" className="flex-1 px-4 pt-8 pb-28 md:pb-14">
          {children}
        </main>
      </ViewTransition>
      <nav
        aria-label="Family (mobile)"
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <NavLink
                href={href}
                className="group mx-1 my-1.5 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-transparent text-xs font-bold"
                activeClassName="border-ink! bg-orange shadow-ink-sm"
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
