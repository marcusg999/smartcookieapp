import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

// School organization portal: school roles only (404 otherwise). Org data is
// further scoped by RLS (org_role()).
const nav = [
  { href: "/school", label: "Overview", exact: true },
  { href: "/school/classrooms", label: "Classrooms" },
  { href: "/school/standing-orders", label: "Standing orders" },
  { href: "/school/invoices", label: "Invoices" },
];

export default async function SchoolLayout({ children }: LayoutProps<"/">) {
  await requireRole(["school_admin", "school_staff"], { next: "/school" });
  const supabase = await createClient();
  const { data: orgs } = await supabase.from("organizations").select("name, status");
  const pending = (orgs ?? []).some((o) => o.status === "pending");
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
        {pending ? (
          <p role="status" className="mb-6 rounded-md border border-chart-3/40 bg-chart-3/10 px-4 py-3 text-sm">
            Your school is waiting for approval. We&apos;ll email you when school ordering is open.
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
