import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TIMEZONE } from "@/lib/constants";

/**
 * Keep-warm ping for an external scheduler (every ~4 minutes). It always warms the server function, and during
 * working hours it also wakes the database so the first click of the day doesn't pay its start-up time.
 *
 * The working-hours window is enforced here, not by the caller: the free Neon plan has 100 compute-hours a
 * month and suspends the database when they run out, so nobody calling this URL can keep it awake around the
 * clock. Mon–Sat 08:00–19:00 company time is about 72 hours a month at the smallest compute size.
 */
const DAYS = new Set([1, 2, 3, 4, 5, 6]); // Mon–Sat
const FROM_HOUR = 8;
const TO_HOUR = 19; // exclusive

export const dynamic = "force-dynamic";

function companyClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return { weekday, hour };
}

export async function GET() {
  const started = Date.now();
  const { weekday, hour } = companyClock(new Date());
  const workingHours = DAYS.has(weekday) && hour >= FROM_HOUR && hour < TO_HOUR;
  let dbOk: boolean | null = null;
  if (workingHours) {
    try {
      await db.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }
  return NextResponse.json(
    { ok: dbOk !== false, database: workingHours ? (dbOk ? "awake" : "error") : "left asleep (outside working hours)", ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
