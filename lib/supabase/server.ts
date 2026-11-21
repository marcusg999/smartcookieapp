import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/lib/env.public";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Cookie-based session (PKCE, httpOnly cookies via @supabase/ssr), publishable
 * key, RLS applies. Create a new client per request; never share one.
 *
 * To identify the user, call `supabase.auth.getClaims()` (verifies the JWT).
 * Never trust `getSession()` on the server: it reads the cookie unverified.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    // MFA recovery (backup) codes are an opt-in SDK feature.
    auth: { experimental: { recoveryCodes: true } },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can't write cookies. That's fine: the proxy
          // (proxy.ts) refreshes the session and writes cookies on every request.
        }
      },
    },
  });
}
