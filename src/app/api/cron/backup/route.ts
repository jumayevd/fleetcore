import { NextResponse } from "next/server";
import { runBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly database copy into the private file store (src/lib/backup.ts). Vercel Cron calls it (vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET set, it refuses: the route must not be open to anyone.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runBackup();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
