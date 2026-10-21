import "server-only";
import { db } from "@/lib/db";
import { kmDriven } from "@/lib/mileage";
import { maintenanceSummary, monthlyFleetSpend, shopDowntime, truckCosts } from "@/lib/stats";
import { WORK_ORDER_CATEGORY_LABELS, humanize } from "@/lib/constants";
import { daysUntil } from "@/lib/format";
import { fleetUnits, unitCompliance, type DocState } from "@/app/(app)/maintenance/_lib/data";
import { periodRange } from "@/app/(app)/maintenance/_lib/period";
import { NO_VENDOR } from "@/app/(app)/maintenance/_lib/shared";
import { CHART_MONTHS, HIGH_L100, MIN_KM_TO_COMPARE, ratio, share, type ReportPeriod } from "./shared";

/** Same window as the maintenance compliance tab: a document expiring within 30 days needs its renewal booked. */
const EXPIRING_DAYS = 30;

export type CategoryRow = { category: string; label: string; jobs: number; cost: number; share: number; avg: number };
export type VendorRow = { vendor: string | null; label: string; jobs: number; cost: number; share: number; avg: number };
export type ComplianceGroup = {
  key: "trucks" | "trailers" | "drivers";
  label: string;
  /** What is checked, for the row's tooltip. */
  checks: string;
  href: string;
  total: number;
} & Record<DocState, number>;

function driverState(expiry: Date | null, required: boolean): DocState {
  if (!expiry) return required ? "missing" : "ok";
  const d = daysUntil(expiry) ?? 0;
  return d < 0 ? "expired" : d <= EXPIRING_DAYS ? "expiring" : "ok";
}
const RANK: Record<DocState, number> = { expired: 0, expiring: 1, missing: 2, ok: 3 };
const worstOf = (states: DocState[]) => states.reduce<DocState>((w, s) => (RANK[s] < RANK[w] ? s : w), "ok");
const blank = (): Record<DocState, number> => ({ expired: 0, expiring: 0, missing: 0, ok: 0 });

/**
 * Everything on the reports page for one period: fleet running costs (maintenance + fuel), km driven from odometer
 * readings, fuel economy, shop downtime, and paperwork as it stands today. The CSV export reads the same data.
 */
export async function reportData(period: ReportPeriod, now = new Date()) {
  const range = periodRange(period, now);
  const done = (from: Date, to: Date) => ({ status: "DONE", completedAt: { gte: from, lt: to } });
  const drivenP = kmDriven(range.from, range.to);
  const prevDrivenP = kmDriven(range.prevFrom, range.prevTo);
  const unitsP = fleetUnits();

  const [driven, prevDriven, maint, prevMaint, trucks, prevTrucks, downtime, prevDowntime, monthly, units, compliance, drivers, vendorGroups] = await Promise.all([
    drivenP,
    prevDrivenP,
    drivenP.then((d) => maintenanceSummary(range.from, range.to, d)),
    db.workOrder.aggregate({ where: done(range.prevFrom, range.prevTo), _sum: { cost: true }, _count: { _all: true } }),
    drivenP.then((d) => truckCosts(range.from, range.to, d)),
    prevDrivenP.then((d) => truckCosts(range.prevFrom, range.prevTo, d)),
    shopDowntime(range.from, range.to),
    shopDowntime(range.prevFrom, range.prevTo),
    monthlyFleetSpend(CHART_MONTHS[period], now),
    unitsP,
    unitsP.then(({ trucks: t, trailers }) => unitCompliance(t, trailers)),
    db.driver.findMany({ where: { status: { not: "INACTIVE" } }, select: { licenseExpiry: true, medicalExpiry: true } }),
    db.workOrder.groupBy({ by: ["vendor"], where: done(range.from, range.to), _sum: { cost: true }, _count: { _all: true } }),
  ]);

  /* KPIs ----------------------------------------------------------- */
  const spend = maint.spend;
  const fuel = trucks.totals.fuel;
  const km = driven.total;
  const running = spend + fuel;
  const prevSpend = prevMaint._sum.cost ?? 0;
  const prevFuel = prevTrucks.totals.fuel;
  const prevKm = prevDriven.total;
  const inService = units.trucks.filter((t) => t.status !== "INACTIVE").length;
  const avgL100 = trucks.totals.l100;
  const highBurn = avgL100 == null ? 0 : trucks.rows.filter((r) => r.l100 != null && r.km >= MIN_KM_TO_COMPARE && r.l100 > avgL100 * HIGH_L100).length;
  const truckCapacity = inService * downtime.windowDays;

  const kpis = {
    maintenance: { value: spend, prev: prevSpend, jobs: maint.records, prevJobs: prevMaint._count._all },
    fuel: { value: fuel, prev: prevFuel, liters: trucks.totals.liters, fills: trucks.totals.fills, perLiter: ratio(fuel, trucks.totals.liters) },
    km: { value: km, prev: prevKm, trucks: trucks.rows.filter((r) => r.km > 0).length, inService, withoutKm: trucks.totals.withoutKm },
    costPerKm: {
      value: ratio(running, km), prev: ratio(prevSpend + prevFuel, prevKm),
      maintenance: ratio(spend, km), fuel: ratio(fuel, km),
    },
    l100: { value: avgL100, prev: prevTrucks.totals.l100, measured: trucks.rows.filter((r) => r.l100 != null).length, high: highBurn },
    downtime: {
      value: downtime.days, prev: prevDowntime.days, units: downtime.rows.length, inShopNow: downtime.inShopNow,
      /** Share of truck-days in service that were not spent in the shop. */
      availability: truckCapacity > 0 ? Math.max(0, Math.min(100, Math.round((1 - downtime.truckDays / truckCapacity) * 1000) / 10)) : null,
    },
  };

  /* Breakdown tables ---------------------------------------------- */
  const categories: CategoryRow[] = maint.byCategory.map((c) => ({
    category: c.name, label: WORK_ORDER_CATEGORY_LABELS[c.name] ?? humanize(c.name), jobs: c.count, cost: c.cost, share: share(c.cost, spend), avg: c.count ? c.cost / c.count : 0,
  }));
  const vendors: VendorRow[] = vendorGroups
    .map((v) => {
      const cost = v._sum.cost ?? 0;
      const jobs = v._count._all;
      return { vendor: v.vendor, label: v.vendor ?? NO_VENDOR, jobs, cost, share: share(cost, spend), avg: jobs ? cost / jobs : 0 };
    })
    .sort((a, b) => b.cost - a.cost || b.jobs - a.jobs);

  /* Paperwork today ----------------------------------------------- */
  const unitGroup = (key: "trucks" | "trailers", type: "truck" | "trailer", label: string, checks: string, href: string): ComplianceGroup => {
    const rows = compliance.rows.filter((r) => r.type === type);
    const counts = blank();
    for (const r of rows) counts[r.worst]++;
    return { key, label, checks, href, total: rows.length, ...counts };
  };
  const driverCounts = blank();
  for (const d of drivers) driverCounts[worstOf([driverState(d.licenseExpiry, true), driverState(d.medicalExpiry, true)])]++;
  const paperwork: ComplianceGroup[] = [
    unitGroup("trucks", "truck", "Trucks", "Registration, insurance and technical inspection", "/maintenance?tab=compliance"),
    unitGroup("trailers", "trailer", "Trailers", "Registration, insurance and technical inspection", "/maintenance?tab=compliance"),
    { key: "drivers", label: "Drivers", checks: "Driving licence and medical certificate expiry dates", href: "/drivers", total: drivers.length, ...driverCounts },
  ];

  return {
    period, range, kpis,
    monthly,
    trucks: trucks.rows, truckTotals: trucks.totals, trailerWork: trucks.trailers,
    running: { maintenance: spend, fuel, total: running },
    categories, vendors,
    downtime: downtime.rows,
    paperwork,
  };
}
export type ReportData = Awaited<ReturnType<typeof reportData>>;
