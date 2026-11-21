import { CalendarDays, ClipboardList, Heart, ShoppingBasket, User } from "lucide-react";

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
      <header className="sticky top-0 z-30 border-b bg-background/95">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Logo href="/menu" label="Family home" />
          <nav aria-label="Family" className="hidden gap-1 md:flex">
            {tabs.map(({ href, label }) => (
              <NavLink
                key={href}
                href={href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                activeClassName="bg-secondary text-foreground"
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1 px-4 pt-6 pb-24 md:pb-10">
        {children}
      </main>
      <nav
        aria-label="Family (mobile)"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <NavLink
                href={href}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                activeClassName="text-primary"
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
