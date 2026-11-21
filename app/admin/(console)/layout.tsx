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
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import { requireStaffAAL2 } from "@/lib/auth/guards";
import type { AppRole } from "@/lib/auth/roles";

// Admin console: staff role (re-read from the database) + AAL2, else 404 or
// the MFA flow. Nav items are filtered by role; each page re-checks its own
// role, and RLS is the final gate.
const ALL: AppRole[] = ["kitchen", "ops", "owner"];
const OPS: AppRole[] = ["ops", "owner"];
const OWNER: AppRole[] = ["owner"];

const nav = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true, roles: ALL },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList, roles: OPS },
  { href: "/admin/kitchen", label: "Kitchen", icon: ChefHat, roles: ALL },
  { href: "/admin/menu", label: "Menu", icon: BookOpen, roles: OWNER },
  { href: "/admin/customers", label: "Customers", icon: Users, roles: OPS },
  { href: "/admin/schools", label: "Schools", icon: School, roles: OPS },
  { href: "/admin/content", label: "Content", icon: FileText, roles: OWNER },
  { href: "/admin/staff", label: "Staff", icon: ShieldCheck, roles: OWNER },
  { href: "/admin/settings", label: "Settings", icon: Settings, roles: OWNER },
];

const linkClass =
  "flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 focus-visible:outline-none";
const activeClass = "bg-sidebar-accent text-sidebar-accent-foreground";

export default async function AdminConsoleLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaffAAL2();
  const items = nav.filter((item) => item.roles.some((role) => user.roles.includes(role)));
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
            {items.map(({ href, label, icon: Icon, exact }) => (
              <li key={href}>
                <NavLink href={href} exact={exact} className={linkClass} activeClassName={activeClass}>
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <form action={signOut} className="hidden px-4 pb-4 md:block">
          <p className="mb-2 truncate text-xs text-muted-foreground">{user.email}</p>
          <Button type="submit" variant="outline" size="sm" className="w-full">
            Sign out
          </Button>
        </form>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8">
        {children}
      </main>
    </div>
  );
}
