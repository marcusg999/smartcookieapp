import { draftMode } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth/guards";
import { safeNext } from "@/lib/auth/redirect";

/**
 * Turns on preview (draft mode) so the real public pages render DRAFT copy.
 * Owner at AAL2 only; anyone else gets a 404. Every page re-checks the role
 * before showing drafts (lib/content/content.ts → isOwnerPreview).
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user || user.aal !== "aal2" || !user.roles.includes("owner")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const draft = await draftMode();
  if (request.nextUrl.searchParams.get("exit") === "1") {
    draft.disable();
    return NextResponse.redirect(
      new URL(safeNext(request.nextUrl.searchParams.get("next"), "/admin/content"), request.url),
    );
  }
  draft.enable();
  return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("path"), "/"), request.url));
}
