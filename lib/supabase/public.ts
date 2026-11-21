import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env.public";

/**
 * Cookie-less, anonymous Supabase client for CACHED public reads (published
 * menu, CMS content, public settings). It never carries a user session, so
 * results are safe to share between visitors; RLS limits it to public rows.
 */
export function createPublicClient() {
  return createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
