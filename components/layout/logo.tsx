import { Cookie } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** Placeholder wordmark until the Smart Cookie brand assets are plugged in. */
export function Logo({ href = "/", className, label }: { href?: string; className?: string; label?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md font-display text-lg font-semibold tracking-tight focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <Cookie aria-hidden="true" className="size-6 text-primary" />
      <span>Smart Cookie</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </Link>
  );
}
