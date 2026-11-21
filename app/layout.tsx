import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";

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
});
const sourceSans = localFont({
  src: [
    { path: "./fonts/source-sans-3-latin-wght-normal.woff2", style: "normal", weight: "200 900" },
    { path: "./fonts/source-sans-3-latin-wght-italic.woff2", style: "italic", weight: "200 900" },
  ],
  variable: "--font-source-sans",
  display: "swap",
});

export const metadata: Metadata = {
  // Placeholder copy. From Phase 3 on, site text comes from the CMS (site_settings).
  title: { default: "Smart Cookie", template: "%s · Smart Cookie" },
  description: "Healthy, home-cooked meals for kids, delivered to families and schools.",
  applicationName: "Smart Cookie",
  appleWebApp: { capable: true, title: "Smart Cookie", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Placeholder; will be pulled from site_settings with the brand.
  themeColor: "#ff5b14",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every request dynamically so each response carries a fresh CSP
  // nonce (see proxy.ts and lib/security/csp.ts).
  await connection();

  return (
    <html lang="en" className={`h-full ${bodoni.variable} ${sourceSans.variable}`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md border-2 border-ink bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
