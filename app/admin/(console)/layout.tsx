import {
  BadgeDollarSign,
  BookOpen,
  ChefHat,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  MapPin,
  Percent,
  Rocket,
  School,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { Toaster } from "@/components/admin/toaster";
import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";
import { StepUpProvider } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { OPS, OWNER, STAFF } from "@/lib/admin/action";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import type { AppRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

// Admin console: staff role (re-read from the database) + AAL2, else 404 or
// the MFA flow. Each item is shown only to the roles allowed to use it, and
// every page and Server Action re-checks the role on the server.
type NavItem = { href: string; label: string; icon?: LucideIcon; roles: AppRole[]; exact?: boolean };
type NavGroup = { label?: string; icon?: LucideIcon; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    items: [
      { href: "/admin", label: "This week", icon: LayoutDashboard, roles: STAFF, exact: true },
      { href: "/admin/orders", label: "Orders", icon: ClipboardList, roles: OPS },
    ],
  },
  {
    label: "Kitchen",
    icon: ChefHat,
    items: [
      { href: "/admin/kitchen", label: "Cook list", roles: STAFF, exact: true },
      { href: "/admin/kitchen/allergies", label: "Allergy board", roles: STAFF },
      { href: "/admin/kitchen/dietary", label: "Dietary roll-up", roles: STAFF },
      { href: "/admin/kitchen/labels", label: "Labels", roles: STAFF },
      { href: "/admin/kitchen/packing", label: "Packing lists", roles: STAFF },
      { href: "/admin/kitchen/manifest", label: "Delivery manifest", roles: OPS },
      { href: "/admin/kitchen/payments", label: "Who has paid", roles: OPS },
    ],
  },
  {
    label: "Menu",
    icon: BookOpen,
    items: [
      { href: "/admin/menu", label: "Items", roles: OWNER, exact: true },
      { href: "/admin/menu/weeks", label: "Weekly menus", roles: OWNER },
      { href: "/admin/menu/templates", label: "Templates", roles: OWNER },
      { href: "/admin/menu/categories", label: "Categories", roles: OWNER },
      { href: "/admin/menu/badges", label: "Badges", roles: OWNER },
      { href: "/admin/menu/allergens", label: "Allergens", roles: OWNER },
    ],
  },
  {
    items: [
      { href: "/admin/plans", label: "Plans", icon: BadgeDollarSign, roles: OWNER },
      { href: "/admin/customers", label: "Customers", icon: Users, roles: OPS },
      { href: "/admin/schools", label: "Schools", icon: School, roles: OPS },
      { href: "/admin/zones", label: "Delivery zones", icon: MapPin, roles: OPS },
    ],
  },
  {
    label: "Content",
    icon: FileText,
    items: [
      { href: "/admin/content", label: "Site text", roles: OWNER, exact: true },
      { href: "/admin/content/pages", label: "Pages", roles: OWNER },
      { href: "/admin/content/faqs", label: "FAQs", roles: OWNER },
      { href: "/admin/content/testimonials", label: "Testimonials", roles: OWNER },
      { href: "/admin/content/emails", label: "Emails", roles: OWNER },
      { href: "/admin/content/media", label: "Media", roles: OWNER },
    ],
  },
  {
    items: [
      { href: "/admin/pilot", label: "Pilot", icon: Rocket, roles: OWNER },
      { href: "/admin/discounts", label: "Discounts", icon: Percent, roles: OWNER },
      { href: "/admin/staff", label: "Staff", icon: ShieldCheck, roles: OWNER },
      { href: "/admin/settings", label: "Settings", icon: Settings, roles: OWNER },
      { href: "/admin/audit", label: "Audit log", icon: History, roles: OWNER },
    ],
  },
];

const linkClass =
  "flex shrink-0 items-center gap-3 rounded-md border-2 border-transparent px-3 py-2 text-sm font-semibold whitespace-nowrap hover:border-ink";
const activeClass = "border-ink! bg-orange shadow-ink-sm";

export default async function AdminConsoleLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaffAAL2();
  const allowed = (item: NavItem) => item.roles.some((role) => user.roles.includes(role));
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = factors?.totp.find((f) => f.status === "verified")?.id ?? null;

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row" data-shell="admin">
      <aside className="border-b-2 border-ink bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-r-2 lg:border-b-0 print:hidden">
        <div className="flex h-16 items-center gap-2 px-4">
          <Logo href="/admin" label="Admin dashboard" />
          <span className="rounded border-2 border-ink bg-orange px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wide uppercase">
            Admin
          </span>
        </div>
        <nav aria-label="Admin" className="overflow-x-auto px-2 pb-3 lg:flex-1 lg:overflow-y-auto">
          <ul className="flex gap-1 lg:flex-col lg:gap-0.5">
            {groups.map((group, gi) =>
              group.label ? (
                <li key={group.label} className="contents lg:mt-3 lg:block">
                  <p className="hidden items-center gap-2 px-3 pb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase lg:flex">
                    {group.icon ? <group.icon aria-hidden="true" className="size-3.5" /> : null}
                    {group.label}
                  </p>
                  <ul className="contents lg:flex lg:flex-col lg:gap-0.5">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <NavLink
                          href={item.href}
                          exact={item.exact}
                          className={`${linkClass} lg:pl-8`}
                          activeClassName={activeClass}
                        >
                          <span className="lg:hidden">{group.label}: </span>
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                group.items.map((item) => (
                  <li key={item.href} className={gi > 0 && item === group.items[0] ? "lg:mt-3" : undefined}>
                    <NavLink href={item.href} exact={item.exact} className={linkClass} activeClassName={activeClass}>
                      {item.icon ? <item.icon aria-hidden="true" className="size-4" /> : null}
                      {item.label}
                    </NavLink>
                  </li>
                ))
              ),
            )}
          </ul>
        </nav>
        <form action={signOut} className="hidden px-4 pb-4 lg:block">
          <p className="mb-2 truncate text-xs text-muted-foreground">{user.email}</p>
          <Button type="submit" variant="outline" size="sm" className="w-full">
            Sign out
          </Button>
        </form>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8 lg:py-8 print:p-0">
        <StepUpProvider factorId={factorId}>{children}</StepUpProvider>
      </main>
      <Toaster />
    </div>
  );
}
