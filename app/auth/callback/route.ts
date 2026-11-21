import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/auth/audit";
import { postSignInDestination } from "@/lib/auth/guards";
import { safeNext } from "@/lib/auth/redirect";
import { SIGNUP_INTENT_COOKIE } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth (Google / Apple) and identity-linking callback: exchanges the PKCE
 * code for a session cookie. Supabase links the identity to an existing
 * account only when the provider's email is verified (automatic linking);
 * unverified emails never link (see docs/phase-2.md).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description");

  if (!code) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("error", errorDescription ? "oauth" : "missing_code");
    return NextResponse.redirect(url);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    await audit("auth.sign_in_failed", { anonymous: true, metadata: { method: "oauth", reason: error?.code } });
    return NextResponse.redirect(new URL("/sign-in?error=oauth", request.url));
  }

  const provider = data.user.app_metadata?.provider ?? "oauth";
  const linking = searchParams.get("link") === "1";
  await audit(linking ? "auth.identity_linked" : "auth.sign_in", {
    entityType: "user",
    entityId: data.user.id,
    metadata: { method: "oauth", provider },
  });

  // "I'm ordering for a school" chosen on the sign-up page before OAuth.
  const jar = await cookies();
  const intentRaw = jar.get(SIGNUP_INTENT_COOKIE)?.value;
  if (intentRaw) {
    jar.delete({ name: SIGNUP_INTENT_COOKIE, path: "/auth" });
    try {
      const intent = JSON.parse(intentRaw) as { accountType?: string; organizationName?: string };
      const isNewUser = Date.now() - new Date(data.user.created_at).getTime() < 10 * 60_000;
      if (intent.accountType === "school" && intent.organizationName && isNewUser) {
        await supabase.rpc("request_school_organization", { p_name: intent.organizationName });
        // Re-issue the token so it carries the new school_admin role.
        await supabase.auth.refreshSession();
      }
    } catch {
      // Ignore a malformed cookie; the user can request a school from their account.
    }
  }

  const destination = linking
    ? safeNext(searchParams.get("next"), "/account/security")
    : await postSignInDestination(searchParams.get("next"));
  return NextResponse.redirect(new URL(destination, request.url));
}
