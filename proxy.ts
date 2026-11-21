import { NextResponse, type NextRequest } from "next/server";

import { isStaff, rolesFromClaims, secondsSinceSignIn } from "@/lib/auth/roles";
import {
  ADMIN_ABSOLUTE_TIMEOUT_SECONDS,
  ADMIN_ACTIVITY_COOKIE,
  ADMIN_IDLE_TIMEOUT_SECONDS,
  isAdminMfaPath,
  isAdminPath,
  requiresSignIn,
} from "@/lib/auth/routes";
import { publicEnv } from "@/lib/env.public";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every matched request (Next.js 16 "proxy", formerly middleware):
 *  1. generates a per-request CSP nonce and sets the Content-Security-Policy,
 *  2. refreshes the Supabase session cookie,
 *  3. makes COARSE routing decisions (sign-in redirects, admin 404/MFA gate,
 *     admin idle/absolute timeouts).
 *
 * The proxy is NOT an authorization boundary: every page, Server Action and
 * Route Handler re-checks with lib/auth/guards.ts, and RLS is the final gate.
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
  const session = await updateSession(request, {
    "x-nonce": nonce,
    "Content-Security-Policy": csp,
  });

  const routed = await protectRoutes(request, session);
  const final = routed ? copySession(session.response, routed) : session.response;

  final.headers.set("Content-Security-Policy", csp);
  return final;
}

type Session = Awaited<ReturnType<typeof updateSession>>;

async function protectRoutes(request: NextRequest, session: Session): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  const { claims } = session;

  if (requiresSignIn(pathname) && !claims) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (!isAdminPath(pathname)) return null;

  // Non-staff (including signed-out visitors) get a plain 404, so /admin
  // doesn't reveal that it exists. Rewriting to an unknown path renders the
  // app's not-found page with status 404.
  if (!claims || !isStaff(rolesFromClaims(claims))) {
    return NextResponse.rewrite(new URL("/__not-found", request.url), { status: 404 });
  }

  // Absolute session limit for staff: 12 h since the session's first sign-in.
  const age = secondsSinceSignIn(claims);
  const now = Math.floor(Date.now() / 1000);
  const lastActivity = Number(request.cookies.get(ADMIN_ACTIVITY_COOKIE)?.value ?? NaN);
  const idle = Number.isFinite(lastActivity) ? now - lastActivity : 0;
  if ((age !== null && age > ADMIN_ABSOLUTE_TIMEOUT_SECONDS) || idle > ADMIN_IDLE_TIMEOUT_SECONDS) {
    await session.supabase.auth.signOut({ scope: "local" });
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("reason", idle > ADMIN_IDLE_TIMEOUT_SECONDS ? "idle" : "expired");
    url.searchParams.set("next", "/admin");
    const res = NextResponse.redirect(url);
    res.cookies.delete(ADMIN_ACTIVITY_COOKIE);
    return res;
  }

  // Staff must be at AAL2 (MFA) everywhere in /admin except the MFA pages.
  let redirect: NextResponse | null = null;
  if (claims.aal !== "aal2" && !isAdminMfaPath(pathname)) {
    const { data } = await session.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const target = data?.nextLevel === "aal2" ? "/admin/mfa/challenge" : "/admin/mfa/enroll";
    redirect = NextResponse.redirect(new URL(target, request.url));
  }

  // Record activity for the idle timeout (httpOnly, never readable by JS).
  (redirect ?? session.response).cookies.set(ADMIN_ACTIVITY_COOKIE, String(now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_ABSOLUTE_TIMEOUT_SECONDS,
  });
  return redirect;
}

/** Copy refreshed session cookies and cache headers onto a different response. */
function copySession(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    if (!to.cookies.has(cookie.name)) to.cookies.set(cookie);
  });
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
