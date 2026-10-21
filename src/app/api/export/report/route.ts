import { NextResponse, type NextRequest } from "next/server";
import { format } from "date-fns";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { reportData } from "@/app/(app)/reports/data";
import { isExportType, parsePeriod } from "@/app/(app)/reports/shared";

export const dynamic = "force-dynamic";

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (v: number) => Math.round(v);
const perKm = (v: number | null) => (v == null ? "" : v.toFixed(2));

/** GET /api/export/report?type=lanes|drivers|trucks&period=30d|90d|6m|12m → CSV of that report table (every row, not just the top of the page). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "reports.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const type = req.nextUrl.searchParams.get("type");
  if (!isExportType(type)) return NextResponse.json({ error: "type must be lanes, drivers or trucks" }, { status: 400 });
  const period = parsePeriod(req.nextUrl.searchParams.get("period"));
  const r = await reportData(period);

  let head: string[];
  let rows: (string | number | null | undefined)[][];
  switch (type) {
    case "lanes":
      head = ["Origin", "Destination", "Loads", "Loaded km", "Empty km", "Total km", "Revenue", "Direct cost", "Margin", "Margin %", "Revenue per km", "Empty %"];
      rows = r.lanes.map((l) => [l.origin, l.dest, l.loads, Math.round(l.km - l.emptyKm), Math.round(l.emptyKm), Math.round(l.km), money(l.revenue), money(l.cost), money(l.margin), l.marginPct, perKm(l.perKm), l.emptyPct]);
      break;
    case "drivers":
      head = ["Driver", "Type", "Loads", "Total km", "Empty km", "On time %", "Revenue", "Earnings", "Score"];
      rows = r.drivers.map((d) => [d.name, d.type, d.loads, Math.round(d.km), Math.round(d.emptyKm), d.onTimePct, money(d.revenue), money(d.earnings), d.score]);
      break;
    case "trucks":
      head = ["Truck", "Model", "Ownership", "Loads", "Total km", "Revenue", "Work orders", "Work order cost", "Cost per km", "Revenue per km"];
      rows = r.trucks.map((t) => [t.unit, t.model, t.ownership, t.loads, Math.round(t.km), money(t.revenue), t.workOrders, money(t.workOrderCost), perKm(t.costPerKm), perKm(t.perKm)]);
      break;
  }

  // The header is the first line so spreadsheets and pivots read it as the header row; the file name carries the
  // report type, period and date.
  const csv = [head.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))].join("\r\n");
  const name = `report-${type}-${period}-${format(r.range.to, "yyyy-MM-dd")}.csv`;
  return new NextResponse(`\uFEFF${csv}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
