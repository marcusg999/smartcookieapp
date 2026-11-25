import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { runMonthlyInvoicing } from "@/lib/payments/school-invoices";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled job (Vercel Cron, daily): on the owner's invoice day, creates
 * last month's Stripe invoice for every school; on other days it only
 * finishes drafts left by a failed run. Reminders run in Postgres (pg_cron).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const result = await runMonthlyInvoicing();
  return NextResponse.json(result);
}
