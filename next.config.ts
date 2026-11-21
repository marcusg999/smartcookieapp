import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { validateEnv } from "./lib/env.schema";
import { securityHeaders } from "./lib/security/headers";

// Fail `next dev` / `next build` immediately if any required env var is
// missing or malformed (CLAUDE.md §5.12). Prints variable names, never values.
validateEnv(process.env);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Menu photos and media come only from this project's Supabase Storage.
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? [new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/**`)]
      : [],
    dangerouslyAllowLocalIP: process.env.NEXT_PUBLIC_APP_ENV === "development",
  },
  // Cache Components (and its Partial Prerendering) is deliberately OFF: a
  // nonce-based CSP needs every page rendered per request, and the Next.js
  // docs state PPR is incompatible with nonces. See docs/phase-1.md.
  cacheComponents: false,
  // forbidden() → 403 for staff who open an admin page their role can't use
  // (Phase 4). Experimental in Next 16; non-staff still get a 404.
  experimental: { authInterrupts: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Only print source-map upload logs in CI.
  silent: !process.env.CI,
  widenClientFileUpload: true,
  telemetry: false,
  // No tunnelRoute: the browser reports straight to the DSN's ingest host,
  // which the CSP allows explicitly (lib/security/csp.ts).
});
