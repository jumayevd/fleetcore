import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverStatusHistory, loadBoardRows, parseBoardDate } from "@/app/(app)/dispatch/board-data";

export const dynamic = "force-dynamic";

/**
 * Live data for the dispatch board (polled every 15 s by the grid).
 *   GET /api/board?date=YYYY-MM-DD[&team=<id>|none]   → BoardPayload
 *   GET /api/board?history=<driverId>                 → { events: StatusEvent[] }
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "loads.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const history = sp.get("history");
  if (history) return NextResponse.json({ events: await driverStatusHistory(history) }, { headers: { "cache-control": "no-store" } });

  const team = sp.get("team");
  const payload = await loadBoardRows(parseBoardDate(sp.get("date")), { teamId: team || null });
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
