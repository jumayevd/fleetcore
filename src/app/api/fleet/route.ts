import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fleetSnapshot } from "@/lib/telemetry";
import { syncCompanyEld } from "@/lib/eld/sync";

export const dynamic = "force-dynamic";

/** How long the map waits for a due ELD sync before answering with what is stored. */
const SYNC_WAIT_MS = 4_000;

/**
 * Live map polling: the active company's trucks in service with their last known position, oil service and defect
 * hold (see fleetSnapshot). Distances and speeds are in the company's own unit. Each poll also gives the ELD sync a
 * chance (at most once a minute): a quick one shows up in this answer, a slow one finishes in the background.
 */
export async function GET() {
  const user = await getCurrentUser();
  // 401 (signed out / session expired) and 403 (role lacks tracking) differ on purpose: the live map
  // sends the first to the login screen and quietly stops polling on the second.
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "tracking.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sync = syncCompanyEld(user.company.id).catch((e) => { console.error("eld sync failed", e); });
  await Promise.race([sync, new Promise((ok) => setTimeout(ok, SYNC_WAIT_MS))]);
  after(() => sync);
  return NextResponse.json(
    { trucks: await fleetSnapshot(), at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
