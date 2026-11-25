import { CalendarDays, ClipboardList, Heart, Smile, User } from "lucide-react";
import { ViewTransition } from "react";

import { HalftoneDefs } from "@/components/art/cartoons";
import { Toaster } from "@/components/admin/toaster";
import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";
import { FeedbackWidget } from "@/components/family/feedback-widget";
import { getContent } from "@/lib/content/content";
import { createClient } from "@/lib/supabase/server";

// Family shell. Mobile-first: a bottom tab bar on phones (where most parents
// order) and a top nav on larger screens. Tab labels come from the CMS.
export default async function FamilyLayout({ children }: LayoutProps<"/">) {
  const [c, supabase] = await Promise.all([getContent(), createClient()]);
  // Pilot families get the feedback button (Phase 10). False when signed out.
  const { data: isPilot } = await supabase.rpc("is_pilot_user");
  const tabs = [
    { href: "/order", label: c.text("nav.tab_menu"), icon: CalendarDays },
    { href: "/orders", label: c.text("nav.tab_orders"), icon: ClipboardList },
    { href: "/children", label: c.text("nav.tab_kids"), icon: Smile },
    { href: "/favorites", label: c.text("nav.tab_favorites"), icon: Heart },
    { href: "/account", label: c.text("nav.tab_account"), icon: User },
  ];
  return (
    <div className="flex min-h-full flex-1 flex-col" data-shell="family">
      <HalftoneDefs />
      <Toaster />
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Logo href="/account" label="Family home" />
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
      {isPilot ? <FeedbackWidget copy={c.group("feedback.")} /> : null}
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
