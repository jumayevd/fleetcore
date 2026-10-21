import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DRIVER_TYPE_SHORT } from "@/lib/constants";
import { parseWeek, weeklyProductionTz } from "@/app/(app)/dispatch/weekly/weekly-data";

export const dynamic = "force-dynamic";

/**
 * One CSV field. Text starting with = + - @ (or a tab / CR) is prefixed with ' so Excel and Sheets don't run it as a
 * formula; numbers are left alone so negative plan deltas stay numeric.
 */
const csvCell = (v: string | number | null | undefined) => {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /api/export/weekly?week=YYYY-MM-DD → CSV of the weekly production board (one line per driver, plus team and grand totals). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "loads.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Same week rules as the page: a real YYYY-MM-DD in company time, otherwise this week.
  const data = await weeklyProductionTz(parseWeek(req.nextUrl.searchParams.get("week")));
  const days = data.days.map((d) => `${d.weekday} ${d.label}`);

  const lines: string[] = [];
  lines.push(["Team", "Driver", "Type", "Truck", "Hold", ...days.flatMap((d) => [`${d} $`, `${d} km`, `${d} loads`]), "Total $", "Total km", "Avg $/km", "Goal $", "Plan delta $", "Days worked", "Efficiency %"].map(csvCell).join(","));
  for (const g of data.groups) {
    for (const r of g.rows) {
      lines.push([
        g.team.name, r.driver.name, DRIVER_TYPE_SHORT[r.driver.type] ?? r.driver.type, r.driver.truck ?? "", r.driver.hold ? "yes" : "",
        ...r.days.flatMap((c) => [Math.round(c.amount), Math.round(c.km), c.loads.map((l) => l.reference).join(" ")]),
        Math.round(r.total), Math.round(r.km), r.rpk.toFixed(2), r.goal, Math.round(r.planDelta), r.daysWorked, r.efficiency,
      ].map(csvCell).join(","));
    }
    lines.push([g.team.name, "Team total", "", "", "", ...Array(21).fill(""), Math.round(g.total), Math.round(g.km), g.km ? (g.total / g.km).toFixed(2) : "0.00", "", "", "", g.efficiency].map(csvCell).join(","));
  }
  lines.push(["All teams", "Grand total", "", "", "", ...Array(21).fill(""), Math.round(data.grand.total), Math.round(data.grand.km), data.grand.rpk.toFixed(2), "", "", "", ""].map(csvCell).join(","));

  const name = `weekly-production-${data.monday}.csv`;
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
