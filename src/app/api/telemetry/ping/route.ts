import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const Ping = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(200).optional(),
  heading: z.number().min(0).max(360).optional(),
});

/**
 * GPS ping from the driver app (browser geolocation). A future ELD / GPS
 * hardware integration can post here too (swap session auth for a device key).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user?.driver) return NextResponse.json({ error: "Driver session required" }, { status: 403 });
  const parsed = Ping.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid ping" }, { status: 400 });

  const truck = await db.truck.findUnique({ where: { driverId: user.driver.id } });
  if (!truck) return NextResponse.json({ error: "No truck assigned to you" }, { status: 409 });

  const { lat, lng, speedKmh, heading } = parsed.data;
  await db.truck.update({
    where: { id: truck.id },
    data: { lat, lng, speedKmh: speedKmh ?? null, heading: heading ?? truck.heading, lastPingAt: new Date(), pingSource: "DEVICE" },
  });
  return NextResponse.json({ ok: true, truck: truck.unitNumber });
}
