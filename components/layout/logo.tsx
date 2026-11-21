import Image from "next/image";
import Link from "next/link";
import { ViewTransition } from "react";

import { CookieMark } from "@/components/art/cartoons";
import { getPublicSettings } from "@/lib/content/settings";
import { cn } from "@/lib/utils";

/**
 * The brand mark: the owner's uploaded logo (Settings → Logo) or, until one
 * is uploaded, the cookie mascot + business name. Named view transition, so
 * the logo stays put while pages change around it.
 */
export async function Logo({ href = "/", className, label }: { href?: string; className?: string; label?: string }) {
  const settings = await getPublicSettings().catch(() => null);
  const name = settings?.business_name ?? "Smart Cookie";
  const logo = settings?.logo_path;
  return (
    <ViewTransition name="brand-logo">
      <Link
        href={href}
        className={cn(
          "group inline-flex items-center gap-2 rounded-md font-display text-xl font-bold tracking-tight italic",
          className,
        )}
      >
        {logo ? (
          <Image
            src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${logo}`}
            alt={name}
            width={120}
            height={48}
            className="h-11 w-auto object-contain"
            priority
          />
        ) : (
          <>
            <CookieMark className="size-9 transition-transform duration-300 group-hover:-rotate-12" />
            <span>{name}</span>
          </>
        )}
        {label ? <span className="sr-only">{label}</span> : null}
      </Link>
    </ViewTransition>
  );
}
