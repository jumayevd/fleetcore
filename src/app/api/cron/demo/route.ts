import { NextResponse } from "next/server";
import { isDemoEnabled, resetDemo } from "@/lib/demo";

export const dynamic = "force-dynamic";
/** Building a whole fleet is a few hundred inserts. */
export const maxDuration = 300;

/**
 * Nightly rebuild of the live demo company (src/lib/demo): whatever visitors changed during the day is gone. Vercel
 * Cron calls it (vercel.json) with `Authorization: Bearer $CRON_SECRET`; it refuses without CRON_SECRET set, and does
 * nothing unless DEMO_ENABLED=true.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDemoEnabled()) return NextResponse.json({ skipped: "DEMO_ENABLED is not true" }, { headers: { "Cache-Control": "no-store" } });
  const result = await resetDemo();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
