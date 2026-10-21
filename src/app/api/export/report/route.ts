import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { dayKey, makeFormat, normalizeLocale } from "@/lib/locale";
import { REPAIR_STAGE_LABELS, humanize } from "@/lib/constants";
import { roLabel } from "@/lib/service";
import { reportData } from "@/app/(app)/reports/data";
import { EXPORT_TYPES, isExportType, parsePeriod } from "@/app/(app)/reports/shared";

export const dynamic = "force-dynamic";

type Value = string | number | null | undefined;
/** A column, and whether it is money (left out for roles without money.view). */
type Col = [header: string, money?: true];

const cell = (v: Value) => {
  const s = v == null ? "" : String(v);
  // Quote separators and line breaks; a leading = + - @ would run as a formula in a spreadsheet, so it is prefixed.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const cents = (v: number) => Math.round(v * 100) / 100;
const fixed = (v: number | null | undefined, digits = 2) => (v == null ? "" : v.toFixed(digits));
const pct = (v: number | null | undefined) => (v == null ? "" : Math.round(v * 1000) / 10);
const yes = (v: boolean) => (v ? "yes" : "no");

/**
 * GET /api/export/report?type=<one of EXPORT_TYPES>&period=month|quarter|year → CSV of that reports table with every row
 * (the page shows the top of the ranked ones). Same data and company scope as the page; distances and volumes in the
 * company's units (named in the headers), dates as the company's calendar days. Money columns only for money.view.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "reports.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const type = req.nextUrl.searchParams.get("type");
  if (!isExportType(type)) return NextResponse.json({ error: `type must be one of ${EXPORT_TYPES.join(", ")}` }, { status: 400 });
  const period = parsePeriod(req.nextUrl.searchParams.get("period"));
  const money = can(user.role, "money.view");
  const locale = normalizeLocale(user.company);
  const f = makeFormat(locale);
  const L = f.labels;
  const day = (d: Date | null | undefined) => (d ? dayKey(d, locale.timezone) : "");
  const r = await reportData(period, locale, { money });
  const cur = locale.currency;

  let cols: Col[];
  let rows: Value[][];
  switch (type) {
    case "trucks":
      cols = [["Truck"], ["Model"], ["Group"], ["Status"], [`Distance (${L.distance})`], ["Fuel fills"], [`Fuel (${L.volume})`], [`Fuel cost (${cur})`, true], [L.economy],
        ["Repair orders"], [`Maintenance cost (${cur})`, true], [`Total cost (${cur})`, true], [`Cost ${L.perDistance} (${cur})`, true]];
      rows = r.trucks.map((t) => [t.unitNumber, t.model, t.group, humanize(t.status), Math.round(t.km), t.fills, fixed(t.liters, 1), cents(t.fuel), fixed(t.economy, 1),
        t.jobs, cents(t.maintenance), cents(t.total), fixed(t.costPerKm, 3)]);
      if (r.trailerWork.jobs) rows.push(["Trailers", "", "", "", "", "", "", "", "", r.trailerWork.jobs, cents(r.trailerWork.maintenance), cents(r.trailerWork.maintenance), ""]);
      break;
    case "monthly":
      cols = [["Month"], ["Start"], ["End"], ["To date"], [`Maintenance cost (${cur})`, true], ["Repairs completed"], [`Fuel cost (${cur})`, true], ["Fuel fills"], [`Fuel (${L.volume})`], [`Total cost (${cur})`, true]];
      rows = r.monthly.map((m) => [m.key, day(m.from), day(new Date(m.to.getTime() - 1)), yes(m.partial), cents(m.maintenance), m.jobs, cents(m.fuel), m.fills, fixed(m.volume, 1), cents(m.maintenance + m.fuel)]);
      break;
    case "repair-types":
      cols = [["Repair type"], ["Repair orders"], [`Cost (${cur})`, true], ["Share of spend %", true], [`Average per order (${cur})`, true], ["Average days in shop"]];
      rows = r.repairTypes.map((t) => [t.label, t.jobs, cents(t.cost), t.share, cents(t.avg), t.avgShopDays ?? ""]);
      break;
    case "vendors":
      cols = [["Vendor"], ["Linked vendor record"], ["Repair orders"], ["Share of orders %"], [`Cost (${cur})`, true], ["Share of spend %", true], [`Average per order (${cur})`, true]];
      rows = r.vendors.map((v) => [v.label, yes(Boolean(v.vendorId)), v.jobs, v.jobShare, cents(v.cost), v.share, cents(v.avg)]);
      break;
    case "systems":
      cols = [["System"], ["Lines of work"], ["Repair orders"], ["Units"], [`Line amounts (${cur})`, true], ["Share of line amounts %", true]];
      rows = r.systems.map((s) => [s.label, s.lines, s.orders, s.units, cents(s.amount), s.share]);
      break;
    case "repeats":
      cols = [["Unit"], ["Unit type"], ["System"], ["Visits"], ["Most visits within 90 days"], ["Shortest gap (days)"], ["Last visit"], ["Repair orders"], [`Line amounts (${cur})`, true]];
      rows = r.repeats.map((x) => [x.unit.unitNumber, x.unit.type, x.label, x.visits, x.within, x.gapDays, day(x.last), x.orders.map((o) => roLabel(o.number)).join(" "), cents(x.amount)]);
      break;
    case "downtime":
      cols = [["Unit"], ["Unit type"], ["Repair orders"], ["Days in shop"], ["In shop now"], ["Longest repair order"], ["Longest repair days"]];
      rows = r.downtime.map((d) => [d.unitNumber, d.type, d.jobs, d.days, yes(d.inShopNow), `${roLabel(d.longest.number)} ${d.longest.title}`, d.longest.days]);
      break;
    case "driver-charges":
      cols = [["Driver"], ["Charges"], ["Told"], ["Not told"], ["Oldest not told"], ["Oldest not told date"], [`Total (${cur})`, true], [`Not told (${cur})`, true]];
      rows = r.driverCharges.map((d) => [d.name, d.charges, d.told, d.notTold, d.oldestNotTold ? roLabel(d.oldestNotTold.number) : "", day(d.oldestNotTold?.at), cents(d.amount), cents(d.notToldAmount)]);
      break;
    case "warranty":
      cols = [["Repair order"], ["Title"], ["Unit"], ["Vendor"], ["Status"], ["Opened"], ["Completed"], ["Days"], [`Amount (${cur})`, true]];
      rows = r.warranty.map((w) => [roLabel(w.number), w.title, w.unit?.unitNumber, w.vendor,
        w.open ? (w.stage ? (REPAIR_STAGE_LABELS[w.stage] ?? humanize(w.stage)) : humanize(w.status)) : "Completed", day(w.opened), day(w.completedAt), w.daysOpen, cents(w.amount)]);
      break;
    case "defects":
      cols = [["Week starting"], ["To date"], ["Found"], ["Closed"]];
      rows = r.defectWeeks.map((w) => [w.key, yes(w.partial), w.found, w.closed]);
      break;
    case "walkarounds":
      cols = [["Week starting"], ["To date"], ["Trucks expected"], ["Videos received"], ["Received %"], ["Reviewed"], ["With issues"], ["Marked missing"]];
      rows = r.walkWeeks.map((w) => [w.key, yes(w.partial), w.expected, w.received, pct(w.rate), w.reviewed, w.issues, w.missing]);
      break;
    case "roadside":
      cols = [["Date"], ["Report number"], ["Level"], ["Place"], ["Driver"], ["Unit"], ["Result"], ["Violations"], ["Out-of-service violations"], ["Out of service"], ["Status"], ["Correction due"]];
      rows = r.roadside.map((x) => [day(x.at), x.reportNumber, x.levelLabel, x.place, x.driver?.name, x.unit?.unitNumber, humanize(x.result), x.violations, x.oosViolations, yes(x.oos), humanize(x.status), day(x.correctionDueAt)]);
      break;
  }

  // Roles without money.view get the same file without the money columns.
  const keep = cols.map(([, isMoney]) => money || !isMoney);
  const head = cols.filter((_, i) => keep[i]).map(([h]) => h);
  const body = rows.map((row) => row.filter((_, i) => keep[i]));

  // The header is the first line so spreadsheets and pivots read it as the header row; the file name carries the
  // report and its window.
  const csv = [head.map(cell).join(","), ...body.map((row) => row.map(cell).join(","))].join("\r\n");
  const name = `fleet-${type}-${day(r.range.from)}-to-${day(r.range.to)}.csv`;
  // A byte-order mark first, so Excel opens the UTF-8 file with the right characters.
  return new NextResponse(`﻿${csv}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
