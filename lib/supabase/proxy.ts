import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env.public";

/**
 * Refreshes the Supabase session on every request (the @supabase/ssr proxy
 * pattern) and forwards the refreshed cookies both to Server Components (via
 * the request) and to the browser (via the response).
 *
 * `extraRequestHeaders` (e.g. the CSP nonce) are re-applied every time the
 * response is rebuilt, so they're never lost when cookies change.
 *
 * Always return the `response` this function gives back (or copy its cookies
 * and cache headers onto a new one). Returning an earlier response drops the
 * refreshed cookies and signs the user out.
 */
export async function updateSession(request: NextRequest, extraRequestHeaders: Record<string, string> = {}) {
  const buildRequestHeaders = () => {
    const headers = new Headers(request.headers);
    for (const [key, value] of Object.entries(extraRequestHeaders)) headers.set(key, value);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: buildRequestHeaders() } });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, cacheHeaders) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: buildRequestHeaders() } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // Prevent CDNs from caching a response that carries a session cookie.
          Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(): it refreshes
  // the token if needed and verifies the JWT signature.
  const { data } = await supabase.auth.getClaims();

  return {
    supabase,
    claims: (data?.claims as Record<string, unknown> | undefined) ?? null,
    // A getter: setAll may replace the response after this function returns
    // (e.g. signOut() in the proxy), and callers must use the latest one.
    get response() {
      return response;
    },
  };
}
