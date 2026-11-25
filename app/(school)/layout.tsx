import { HalftoneDefs } from "@/components/art/cartoons";
import { Toaster } from "@/components/admin/toaster";
import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";
import { requireRole } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getSchoolContext } from "@/lib/school/queries";

// School organization portal (Phase 7): its own shell and navigation, sharing
// the menu and kitchen pipeline underneath. School roles only (404
// otherwise); every query is further scoped by RLS to the user's school.
export default async function SchoolLayout({ children }: LayoutProps<"/">) {
  await requireRole(["school_admin", "school_staff"], { next: "/school" });
  const [c, ctx] = await Promise.all([getContent(), getSchoolContext()]);
  const isAdmin = ctx?.role === "school_admin";
  const approved = ctx?.school.status === "approved";
  const nav = [
    { href: "/school", label: c.text("school.nav.overview"), exact: true, show: true },
    { href: "/school/orders", label: c.text("school.nav.orders"), show: approved },
    { href: "/school/classrooms", label: c.text("school.nav.classrooms"), show: true },
    { href: "/school/standing-orders", label: c.text("school.nav.standing"), show: approved },
    { href: "/school/calendar", label: c.text("school.nav.calendar"), show: approved },
    { href: "/school/bulk", label: c.text("school.nav.bulk"), show: approved && isAdmin },
    { href: "/school/billing", label: c.text("school.nav.billing"), show: isAdmin },
    { href: "/school/staff", label: c.text("school.nav.staff"), show: isAdmin },
    { href: "/school/setup", label: c.text("school.nav.setup"), show: isAdmin },
  ].filter((n) => n.show);
  return (
    <div className="flex min-h-full flex-1 flex-col" data-shell="school">
      <HalftoneDefs />
      <Toaster />
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Logo href="/school" />
            <span className="rounded-full border-2 border-ink bg-orange-tint px-2.5 py-0.5 text-xs font-bold">
              {ctx?.school.name ?? c.text("school.badge")}
            </span>
          </div>
          <nav aria-label={c.text("school.nav.label")} className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:pb-0">
            {nav.map(({ href, label, exact }) => (
              <NavLink
                key={href}
                href={href}
                exact={exact}
                className="shrink-0 rounded-md border-2 border-transparent px-3 py-1.5 text-sm font-semibold hover:border-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
                activeClassName="border-ink! bg-orange shadow-ink-sm"
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {ctx && ctx.school.status !== "approved" ? (
          <p
            role="status"
            className="mb-6 rounded-xl border-2 border-ink bg-orange-tint px-4 py-3 text-sm font-semibold"
          >
            {ctx.school.status === "pending" ? c.text("school.pending_banner") : c.text("school.suspended_banner")}
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
