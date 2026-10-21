import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fleetSnapshot } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  // 401 (signed out / session expired) and 403 (role lacks tracking) differ on purpose: the live map
  // sends the first to the login screen and quietly stops polling on the second.
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "tracking.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ trucks: await fleetSnapshot(), at: new Date().toISOString() });
}
