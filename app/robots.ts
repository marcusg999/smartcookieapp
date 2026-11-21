import type { MetadataRoute } from "next";

import { publicEnv } from "@/lib/env.public";

/** Public pages are crawlable; signed-in areas, the admin and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  const production = publicEnv.NEXT_PUBLIC_APP_ENV === "production";
  return {
    rules: production
      ? {
          userAgent: "*",
          allow: "/",
          disallow: [
            "/admin",
            "/api",
            "/account",
            "/order",
            "/orders",
            "/checkout",
            "/cart",
            "/children",
            "/favorites",
            "/subscription",
            "/welcome",
            "/school",
            "/auth",
          ],
        }
      : { userAgent: "*", disallow: "/" }, // dev / staging never get indexed
    sitemap: new URL("/sitemap.xml", publicEnv.NEXT_PUBLIC_SITE_URL).toString(),
  };
}
