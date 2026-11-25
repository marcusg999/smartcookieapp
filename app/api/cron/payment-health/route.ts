import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { checkPaymentHealth } from "@/lib/payments/health";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Scheduled job (Vercel Cron, daily): stuck payments, Stripe/DB mismatches, failed webhooks. */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  // Service role: a background job across all households' orders.
  const health = await checkPaymentHealth(createAdminClient());
  return NextResponse.json({
    stuck: health.stuckOrders.length,
    mismatches: health.stripeMismatches.length,
    failedWebhooks: health.failedWebhooks,
  });
}
