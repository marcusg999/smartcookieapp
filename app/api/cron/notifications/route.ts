import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { processEmailQueue } from "@/lib/email/worker";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Scheduled job (Vercel Cron, every minute): drains the email queue. Emails
 * are queued in Postgres by triggers and pg_cron jobs (queue_email); this
 * route renders and sends them (lib/email/worker.ts).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  // Service role: a background job with no user session; it reads queued
  // rows and the data each email needs across households.
  const result = await processEmailQueue(createAdminClient());
  return NextResponse.json(result);
}
