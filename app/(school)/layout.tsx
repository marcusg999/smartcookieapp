import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";

// School organization portal shell. Org-scoped auth guard arrives in Phase 2.
const nav = [
  { href: "/school", label: "Overview", exact: true },
  { href: "/school/classrooms", label: "Classrooms" },
  { href: "/school/standing-orders", label: "Standing orders" },
  { href: "/school/invoices", label: "Invoices" },
];

export default function SchoolLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col" data-shell="school">
      <header className="border-b bg-accent/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Logo href="/school" />
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
              School portal
            </span>
          </div>
          <nav aria-label="School" className="-mx-1 flex gap-1 overflow-x-auto">
            {nav.map(({ href, label, exact }) => (
              <NavLink
                key={href}
                href={href}
                exact={exact}
                className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                activeClassName="bg-background text-foreground shadow-xs"
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
