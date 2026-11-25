import { NextResponse, type NextRequest } from "next/server";

import { unsubscribeParams } from "@/lib/email/unsubscribe";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";

/**
 * RFC 8058 one-click unsubscribe (the List-Unsubscribe-Post header). Mail
 * providers POST here without cookies; the random token in the URL is the
 * only key and identifies just a preferences row. GET (a person or a link
 * scanner opening the URL) shows the confirmation page instead, so a
 * prefetch can never unsubscribe anyone.
 */
export async function POST(request: NextRequest) {
  if (!(await rateLimit("codeCheck", clientIp(request.headers))).success)
    return new NextResponse(null, { status: 429 });
  const parsed = unsubscribeParams.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  // email_unsubscribe is security definer and granted to anon; it only flips
  // the opt-out flags for the row holding this token.
  const supabase = await createClient();
  await supabase.rpc("email_unsubscribe", { p_token: parsed.data.token, p_category: parsed.data.topic });
  return new NextResponse(null, { status: 200 });
}

export function GET(request: NextRequest) {
  const url = new URL("/unsubscribe", request.url);
  url.search = request.nextUrl.search;
  return NextResponse.redirect(url, 303);
}
