import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/auth/audit";
import { postSignInDestination } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Email link landing (sign-up confirmation, magic link, password recovery,
 * staff invite, email change). Verifies the single-use `token_hash`
 * server-side and sets the session cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type || !TYPES.includes(type)) {
    return NextResponse.redirect(new URL("/sign-in?error=link", request.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    await audit("auth.link_failed", { anonymous: true, metadata: { type, reason: error?.code } });
    return NextResponse.redirect(new URL("/sign-in?error=link", request.url));
  }

  const action =
    type === "recovery"
      ? "auth.password_recovery"
      : type === "signup" || type === "email"
        ? "auth.email_confirmed"
        : type === "invite"
          ? "auth.invite_accepted"
          : type === "email_change"
            ? "auth.email_changed"
            : "auth.sign_in";
  await audit(action, { entityType: "user", entityId: data.user.id, metadata: { method: "email_link", type } });

  if (type === "recovery") return NextResponse.redirect(new URL("/reset-password", request.url));
  return NextResponse.redirect(new URL(await postSignInDestination(searchParams.get("next")), request.url));
}
