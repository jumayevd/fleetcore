import { NextResponse } from "next/server";
import { syncAllEld } from "@/lib/eld/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sync every company's ELD, for when nobody has FleetCore open. Vercel Cron calls it (vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`; an outside scheduler can call it the same way, every few minutes.
 * Without CRON_SECRET set, it refuses: the route must not be open to anyone.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await syncAllEld();
  return NextResponse.json({
    companies: results.length,
    ok: results.filter((r) => r.result.status === "ok").length,
    errors: results.filter((r) => r.result.status === "error").length,
  });
}
