import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { eldPulse, syncCompanyEld } from "@/lib/eld/sync";

export const dynamic = "force-dynamic";

/** How long the heartbeat waits for the sync before answering (a slow one finishes in the background). */
const SYNC_WAIT_MS = 8_000;

/**
 * The heartbeat of an open page (components/eld-heartbeat.tsx), every 5 s: runs the company's ELD sync when it is
 * due, then says when a sync last changed a reading, so the page refreshes when that moves on.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sync = syncCompanyEld(user.company.id).catch((e) => { console.error("eld sync failed", e); });
  await Promise.race([sync, new Promise((ok) => setTimeout(ok, SYNC_WAIT_MS))]);
  after(() => sync);
  return NextResponse.json(
    { ...(await eldPulse(user.company.id)), now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
