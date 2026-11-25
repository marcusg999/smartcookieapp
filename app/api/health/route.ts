import { NextResponse } from "next/server";

import { createPublicClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

/**
 * Uptime check (Phase 10): an external monitor polls this. It answers 200
 * when the app can reach the database, 503 otherwise. No secrets, no data.
 */
export async function GET() {
  const started = Date.now();
  let db = false;
  try {
    const { error } = await createPublicClient().from("site_settings_public").select("timezone").limit(1);
    db = !error;
  } catch {
    db = false;
  }
  return NextResponse.json(
    { ok: db, db: db ? "up" : "down", ms: Date.now() - started },
    { status: db ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
