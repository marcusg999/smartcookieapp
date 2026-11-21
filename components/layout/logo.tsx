import Link from "next/link";
import { ViewTransition } from "react";

import { CookieMark } from "@/components/art/cartoons";
import { cn } from "@/lib/utils";

/**
 * Placeholder wordmark (cookie mascot + Bodoni) until the Smart Cookie brand
 * assets are plugged in. Named view transition, so the logo stays put while
 * pages change around it.
 */
export function Logo({ href = "/", className, label }: { href?: string; className?: string; label?: string }) {
  return (
    <ViewTransition name="brand-logo">
      <Link
        href={href}
        className={cn(
          "group inline-flex items-center gap-2 rounded-md font-display text-xl font-bold tracking-tight italic",
          className,
        )}
      >
        <CookieMark className="size-9 transition-transform duration-300 group-hover:-rotate-12" />
        <span>Smart Cookie</span>
        {label ? <span className="sr-only">{label}</span> : null}
      </Link>
    </ViewTransition>
  );
}
