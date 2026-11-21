"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type NavLinkProps = ComponentProps<typeof Link> & {
  href: string;
  /** Match only the exact path (for section index links like /admin). */
  exact?: boolean;
  activeClassName?: string;
};

/** Link that sets aria-current="page" and an active style for the current route. */
export function NavLink({ href, exact = false, className, activeClassName, ...props }: NavLinkProps) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(className, active && activeClassName)}
      {...props}
    />
  );
}
