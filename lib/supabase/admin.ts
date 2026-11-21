import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * Service-role ("secret key") Supabase client. BYPASSES ROW LEVEL SECURITY.
 *
 * Allowed uses only (CLAUDE.md §5.2): Stripe webhooks, scheduled/admin jobs,
 * and other server-side work that has no end-user session. Every call site
 * must carry a comment explaining *why* RLS can't be used there. Never pass
 * this client, or anything derived from it, to the browser.
 */
export function createAdminClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
