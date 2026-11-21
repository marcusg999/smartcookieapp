import {
  BookOpen,
  ChefHat,
  ClipboardList,
  FileText,
  LayoutDashboard,
  School,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";

import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Smart Cookie" },
  robots: { index: false, follow: false },
};

// Admin shell: separate layout and (from Phase 2) a separate guard that
// requires a staff role and MFA (AAL2). Nav items will be filtered by role.
const nav = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/kitchen", label: "Kitchen", icon: ChefHat },
  { href: "/admin/menu", label: "Menu", icon: BookOpen },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/schools", label: "Schools", icon: School },
  { href: "/admin/content", label: "Content", icon: FileText },
  { href: "/admin/staff", label: "Staff", icon: ShieldCheck },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

const linkClass =
  "flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 focus-visible:outline-none";
const activeClass = "bg-sidebar-accent text-sidebar-accent-foreground";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row" data-shell="admin">
      <aside className="border-b bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2 px-4">
          <Logo href="/admin" label="Admin dashboard" />
          <span className="rounded bg-primary px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wide text-primary-foreground uppercase">
            Admin
          </span>
        </div>
        <nav aria-label="Admin" className="overflow-x-auto px-2 pb-2 md:flex-1 md:overflow-y-auto">
          <ul className="flex gap-1 md:flex-col">
            {nav.map(({ href, label, icon: Icon, exact }) => (
              <li key={href}>
                <NavLink href={href} exact={exact} className={linkClass} activeClassName={activeClass}>
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8">
        {children}
      </main>
    </div>
  );
}
