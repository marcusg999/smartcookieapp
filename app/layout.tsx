import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";

import { getContent } from "@/lib/content/content";
import { brandCss, getPublicSettings, type PublicSettings } from "@/lib/content/settings";
import { publicEnv } from "@/lib/env.public";

import "./globals.css";

// Self-hosted variable fonts (OFL, see app/fonts). Served from 'self', so the
// CSP's font-src stays strict.
const bodoni = localFont({
  src: [
    { path: "./fonts/bodoni-moda-latin-wght-normal.woff2", style: "normal", weight: "400 900" },
    { path: "./fonts/bodoni-moda-latin-wght-italic.woff2", style: "italic", weight: "400 900" },
  ],
  variable: "--font-bodoni",
  display: "swap",
  // Display face: not preloaded, so the body font (which paints the first
  // text) isn't competing for bandwidth on slow phones. Headings swap in.
  preload: false,
});
const sourceSans = localFont({
  src: [
    { path: "./fonts/source-sans-3-latin-wght-normal.woff2", style: "normal", weight: "200 900" },
    { path: "./fonts/source-sans-3-latin-wght-italic.woff2", style: "italic", weight: "200 900" },
  ],
  variable: "--font-source-sans",
  display: "swap",
});

/** Site-wide SEO from the CMS (business name from settings, description from content). */
export async function generateMetadata(): Promise<Metadata> {
  const [settings, c] = await Promise.all([safeSettings(), getContent().catch(() => null)]);
  const name = settings?.business_name ?? "Smart Cookie";
  const description = c?.text("seo.site_description") || undefined;
  return {
    metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
    title: { default: name, template: `%s · ${name}` },
    description,
    applicationName: name,
    openGraph: { type: "website", siteName: name, title: name, description, locale: "en_US" },
    twitter: { card: "summary", title: name, description },
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
    formatDetection: { telephone: false },
  };
}

const FALLBACK_INK = "#1f3b2d";

/** Settings, or null if the database is unreachable (the site still renders with the CSS defaults). */
async function safeSettings(): Promise<PublicSettings | null> {
  try {
    return await getPublicSettings();
  } catch {
    return null;
  }
}

export async function generateViewport(): Promise<Viewport> {
  const settings = await safeSettings();
  const bg = settings?.brand_colors?.background;
  return { themeColor: bg && /^#[0-9a-f]{6}$/i.test(bg) ? bg : FALLBACK_INK, width: "device-width", initialScale: 1 };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every request dynamically so each response carries a fresh CSP
  // nonce (see proxy.ts and lib/security/csp.ts).
  await connection();
  const [settings, nonce] = await Promise.all([safeSettings(), headers().then((h) => h.get("x-nonce") ?? undefined)]);
  const css = settings ? brandCss(settings.brand_colors ?? {}) : "";
  const announcement = settings?.announcement?.enabled && settings.announcement.text ? settings.announcement : null;
  const link = announcement?.link && /^(https:\/\/|\/(?!\/))/.test(announcement.link) ? announcement.link : null;

  return (
    <html lang="en" className={`h-full ${bodoni.variable} ${sourceSans.variable}`}>
      {/* Owner-chosen brand colours (Settings) override the CSS defaults. Only validated hex values are emitted. */}
      {css ? <style nonce={nonce}>{css}</style> : null}
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md border-2 border-ink bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {announcement ? (
          <div
            role="region"
            aria-label="Announcement"
            className="border-b-2 border-ink bg-orange px-4 py-2 text-center text-sm font-semibold"
          >
            {link ? (
              <Link href={link} className="underline underline-offset-4">
                {announcement.text}
              </Link>
            ) : (
              announcement.text
            )}
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
