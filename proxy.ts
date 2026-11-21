import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env.public";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every matched request (Next.js 16 "proxy", formerly middleware):
 *  1. generates a per-request CSP nonce and sets the Content-Security-Policy,
 *  2. refreshes the Supabase session cookie.
 *
 * Static security headers (HSTS, X-Frame-Options, …) come from next.config.ts.
 * The proxy is NOT an authorization boundary: every Server Action and Route
 * Handler checks auth itself, and RLS is the final gate.
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    sentryDsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
  });

  // Next.js reads the nonce from the request's CSP header during rendering.
  const { response, claims } = await updateSession(request, {
    "x-nonce": nonce,
    "Content-Security-Policy": csp,
  });

  const redirect = protectRoutes(request, claims);
  const final = redirect ? copySession(response, redirect) : response;

  final.headers.set("Content-Security-Policy", csp);
  return final;
}

/**
 * Route protection: stub until Phase 2 (auth). Phase 2 will redirect
 * signed-out users away from /account, /school and /admin, and AAL1 staff on
 * /admin to the MFA challenge (CLAUDE.md §5.4). Returns a redirect response,
 * or null to continue.
 */
function protectRoutes(_request: NextRequest, _claims: Record<string, unknown> | null): NextResponse | null {
  return null;
}

/** Copy refreshed session cookies and cache headers onto a different response. */
function copySession(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) to.headers.set(header, value);
  }
  return to;
}

export const config = {
  matcher: [
    /*
     * Everything except: API routes (webhooks don't need CSP or session),
     * static files, image optimization, metadata files, and link prefetches.
     */
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|icons/|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
