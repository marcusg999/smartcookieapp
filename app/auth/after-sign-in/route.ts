import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/auth/audit";
import { getUser, postSignInDestination } from "@/lib/auth/guards";

/** Landing after a client-side sign-in (passkey): audits and routes by role. */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const method = request.nextUrl.searchParams.get("method") === "passkey" ? "passkey" : "client";
  await audit("auth.sign_in", { entityType: "user", entityId: user.id, metadata: { method } });
  return NextResponse.redirect(
    new URL(await postSignInDestination(request.nextUrl.searchParams.get("next")), request.url),
  );
}
