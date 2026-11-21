import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import "./globals.css";

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
  themeColor: "#c2410c",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every request dynamically so each response carries a fresh CSP
  // nonce (see proxy.ts and lib/security/csp.ts).
  await connection();

  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
