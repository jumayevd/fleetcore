import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { PAYMENT_STATUS_LABELS } from "@/lib/constants";
import { downtime, payerLabel, repairStatusLabel, repairTypeLabel, stageLabel, systemLabel } from "@/components/shop/shared";
import { parseRepairFilters, repairRowInclude, repairWhere, sortRepairs, unitDriver } from "@/app/(app)/maintenance/_lib/repairs";

export const dynamic = "force-dynamic";

type Value = string | number | null | undefined;

const cell = (v: Value) => {
  const s = v == null ? "" : String(v);
  // Quote separators and line breaks; a leading = + - @ would run as a formula in a spreadsheet, so it is prefixed.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const round2 = (v: number | null | undefined) => (v == null ? "" : Math.round(v * 100) / 100);

/**
 * GET /api/export/repairs?status=&kind=&shop=&unit=&type=&payer=&stage=&told=&q= → CSV of the repairs list with the
 * same filters as the page (every row, not just the first page). Dates in company time; distances in the company's
 * unit; money columns only for people who can see money.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "fleet.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const money = can(user.role, "money.view");
  const f = await getFormat();
  const filters = parseRepairFilters(Object.fromEntries(req.nextUrl.searchParams));
  const now = new Date();
  const rows = sortRepairs(
    await db.workOrder.findMany({ where: repairWhere(filters, now, f.startOfDay(now)), include: repairRowInclude, orderBy: { createdAt: "desc" }, take: 5000 }),
    filters.view,
  );
  const stamp = (d: Date | null | undefined) => (d ? f.dateTimeInput(d).replace("T", " ") : "");
  const day = (d: Date | null | undefined) => (d ? f.dateInput(d) : "");
  const dist = f.labels.distance;

  const head = [
    "Repair", "Opened", "Unit", "Unit type", "Driver", "Repair type", "Title", "What was done", "Shop", "Technician", "Status", "Stage",
    "Who pays", "Charged driver", "Driver told", "Booked for", "In the shop", "Promised back", "Back in service", "Downtime (hours)",
    `Odometer in (${dist})`, `Odometer out (${dist})`,
    ...(money ? ["Lines total", "Invoice number", "Invoice total", "Payment", "Cost"] : []),
    "Void reason",
  ];
  const body = rows.map((w) => {
    const d = downtime(w, now.getTime());
    const linesTotal = w.lines.reduce((a, l) => a + l.amount, 0);
    return [
      roLabel(w.number), day(w.createdAt), w.truck?.unitNumber ?? w.trailer?.unitNumber, w.truckId ? "Truck" : w.trailerId ? "Trailer" : "",
      unitDriver(w)?.name, repairTypeLabel(w.repairType), w.title,
      w.lines.map((l) => `${systemLabel(l.system)}: ${l.work}${money && l.amount ? ` (${round2(l.amount)})` : ""}`).join("; "),
      w.vendorRef?.name ?? w.vendor, w.technician, repairStatusLabel(w), w.status === "IN_PROGRESS" ? stageLabel(w.stage) : "",
      payerLabel(w.payer), w.chargeDriver?.name, w.payer === "DRIVER" ? (w.driverInformedAt ? stamp(w.driverInformedAt) : "no") : "",
      day(w.scheduledAt), stamp(w.inAt), day(w.promisedAt), stamp(w.outAt), d ? Math.round((d.ms / 3_600_000) * 10) / 10 : "",
      w.odometerKm, w.odometerOutKm,
      ...(money ? [w.lines.length ? round2(linesTotal) : "", w.invoiceNumber, round2(w.invoiceTotal), w.paymentStatus ? PAYMENT_STATUS_LABELS[w.paymentStatus] : "", round2(w.cost)] : []),
      w.voidReason,
    ] as Value[];
  });

  const csv = [head.map(cell).join(","), ...body.map((r) => r.map(cell).join(","))].join("\r\n");
  const name = `repairs-${filters.view}-${f.dateInput(now)}.csv`;
  return new NextResponse(`﻿${csv}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
