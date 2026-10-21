import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadShellData } from "@/lib/shell";

export const dynamic = "force-dynamic";

/** Bell alerts and nav counts for the company this browser works in. Fetched by the app shell after each page renders. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json(await loadShellData(user.role), { headers: { "cache-control": "no-store" } });
}
