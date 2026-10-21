import { NextResponse } from "next/server";
import { sendDailyDigest } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** Vercel Cron (see vercel.json) calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await sendDailyDigest());
}
