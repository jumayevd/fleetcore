import { NextResponse, type NextRequest } from "next/server";
import { format } from "date-fns";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { reportData } from "@/app/(app)/reports/data";
import { EXPORT_TYPES, isExportType, parsePeriod } from "@/app/(app)/reports/shared";

export const dynamic = "force-dynamic";

type Value = string | number | null | undefined;

const cell = (v: Value) => {
  const s = v == null ? "" : String(v);
  // Quote separators and line breaks; a leading = + - @ would run as a formula in a spreadsheet, so it is prefixed.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const money = (v: number) => Math.round(v * 100) / 100;
const fixed = (v: number | null, digits = 2) => (v == null ? "" : v.toFixed(digits));
const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * GET /api/export/report?type=trucks|monthly|categories|vendors|downtime&period=month|quarter|year → CSV of that
 * reports table with every row (the page shows the top of the ranked ones). Same data and company scope as the page.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "reports.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const type = req.nextUrl.searchParams.get("type");
  if (!isExportType(type)) return NextResponse.json({ error: `type must be one of ${EXPORT_TYPES.join(", ")}` }, { status: 400 });
  const period = parsePeriod(req.nextUrl.searchParams.get("period"));
  const r = await reportData(period);
  const from = iso(r.range.from);
  const to = iso(r.range.to);

  let head: string[];
  let rows: Value[][];
  switch (type) {
    case "trucks":
      head = ["Truck", "Model", "Group", "Status", "Km driven", "Fuel fills", "Litres", "Fuel cost", "L/100 km", "Work orders", "Maintenance cost", "Total cost", "Cost per km"];
      rows = r.trucks.map((t) => [t.unitNumber, t.model, t.group, t.status, Math.round(t.km), t.fills, Math.round(t.liters), money(t.fuel), fixed(t.l100, 1), t.jobs, money(t.maintenance), money(t.total), fixed(t.costPerKm, 3)]);
      if (r.trailerWork.jobs) rows.push(["Trailers", "", "", "", "", "", "", "", "", r.trailerWork.jobs, money(r.trailerWork.maintenance), money(r.trailerWork.maintenance), ""]);
      break;
    case "monthly":
      head = ["Month", "Start", "End", "To date", "Maintenance cost", "Work orders", "Fuel cost", "Fuel fills", "Litres", "Total cost"];
      rows = r.monthly.map((m) => [m.label, iso(m.from), iso(m.to), m.partial ? "yes" : "no", money(m.maintenance), m.jobs, money(m.fuel), m.fills, m.liters, money(m.maintenance + m.fuel)]);
      break;
    case "categories":
      head = ["Category", "Work orders", "Cost", "Share %", "Average per job"];
      rows = r.categories.map((c) => [c.label, c.jobs, money(c.cost), c.share, money(c.avg)]);
      break;
    case "vendors":
      head = ["Vendor", "Work orders", "Cost", "Share %", "Average per job"];
      rows = r.vendors.map((v) => [v.label, v.jobs, money(v.cost), v.share, money(v.avg)]);
      break;
    case "downtime":
      head = ["Unit", "Type", "Work orders", "Days in shop", "In shop now", "Longest job", "Longest job days"];
      rows = r.downtime.map((d) => [d.unitNumber, d.type, d.jobs, d.days, d.inShopNow ? "yes" : "no", `#${d.longest.number} ${d.longest.title}`, d.longest.days]);
      break;
  }

  // The header is the first line so spreadsheets and pivots read it as the header row; the file name carries the
  // report and its window.
  const csv = [head.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))].join("\r\n");
  const name = `fleet-${type}-${from}-to-${to}.csv`;
  return new NextResponse(`﻿${csv}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
