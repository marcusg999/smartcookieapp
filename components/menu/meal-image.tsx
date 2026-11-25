import Image from "next/image";

import { MEAL_ART, type MealArtKey } from "@/components/art/cartoons";
import { cn } from "@/lib/utils";

/**
 * A meal's picture: an uploaded photo (Supabase Storage via next/image) or,
 * before real photos exist, the built-in cartoon art (`placeholder:<key>`).
 */
export function MealImage({
  path,
  alt,
  className,
  sizes = "(min-width: 768px) 320px, 100vw",
  bucket = "menu-images",
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  bucket?: string;
}) {
  if (!path || path.startsWith("placeholder:")) {
    const key = (path?.slice("placeholder:".length) ?? "cookie") as MealArtKey;
    const Art = MEAL_ART[key] ?? MEAL_ART.cookie;
    return (
      <div
        className={cn("flex items-center justify-center bg-concrete", className)}
        // Empty alt = decorative (the meal's name is right beside it): hide it
        // from screen readers instead of announcing an unnamed image.
        {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}
      >
        <Art className="h-3/4 w-auto max-w-[80%]" />
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden bg-concrete", className)}>
      <Image
        src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
      />
    </div>
  );
}
