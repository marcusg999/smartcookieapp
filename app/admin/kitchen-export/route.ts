import { NextResponse } from "next/server";

import { STAFF } from "@/lib/admin/action";
import { authorizeAction } from "@/lib/auth/guards";
import { getKitchenSettings, getKitchenWeeks, getWeekLines } from "@/lib/kitchen/data";
import { cookable, cookList, cookListCsv, labelData } from "@/lib/kitchen/logic";
import { cookListPdf, labelsPdf } from "@/lib/kitchen/pdf";

export const dynamic = "force-dynamic";

/**
 * Kitchen downloads: cook list (PDF / CSV) and meal labels (PDF). Staff at
 * AAL2 only. Read with the staff member's own session, so the database
 * decides what's included; no prices or contact details are in these files.
 */
export async function GET(request: Request) {
  const auth = await authorizeAction({ roles: STAFF, aal2: true });
  if (auth.error)
    return new NextResponse(null, { status: !auth.error.ok && auth.error.error === "unauthorized" ? 401 : 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const weekId = url.searchParams.get("week") ?? "";
  const day = url.searchParams.get("day");
  const weeks = await getKitchenWeeks();
  const week = weeks.find((w) => w.id === weekId);
  if (!week) return new NextResponse("Unknown week", { status: 404 });
  const [lines, settings] = await Promise.all([getWeekLines(week.id), getKitchenSettings()]);
  const cooking = cookable(lines, settings).filter((l) => !day || l.delivery_date === day);
  const name = `smart-cookie-${week.week_start}${day ? `-${day}` : ""}`;
  const headers = (type: string, file: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${file}"`,
    "cache-control": "private, no-store",
  });
  switch (kind) {
    case "cook-csv":
      return new NextResponse(cookListCsv(cookList(cooking)), {
        headers: headers("text/csv; charset=utf-8", `${name}-cook-list.csv`),
      });
    case "cook-pdf":
      return new NextResponse(
        new Uint8Array(await cookListPdf(cookList(cooking), `Cook list: week of ${week.week_start}`)),
        {
          headers: headers("application/pdf", `${name}-cook-list.pdf`),
        },
      );
    case "labels":
      return new NextResponse(
        new Uint8Array(
          await labelsPdf(
            labelData(cooking, settings),
            settings.label_sheet,
            `Meal labels: week of ${week.week_start}`,
          ),
        ),
        { headers: headers("application/pdf", `${name}-labels.pdf`) },
      );
    default:
      return new NextResponse("Unknown export", { status: 400 });
  }
}
