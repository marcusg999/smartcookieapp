import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env.public";

/**
 * Supabase client for Client Components. Uses the publishable key, so every
 * query is subject to Row Level Security. `createBrowserClient` is a singleton.
 */
export function createClient() {
  return createBrowserClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
