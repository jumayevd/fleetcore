import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { kmDriven } from "@/lib/mileage";
import { shopDowntime, truckCosts, type TruckCostRow } from "@/lib/stats";
import { REQUIRED_UNIT_DOCS } from "@/lib/documents";
import { dateOnly, dayKey, makeFormat, type CompanyLocale } from "@/lib/locale";
import { INSPECTION_LEVEL_LABELS, REPAIR_SYSTEM_LABELS, REPAIR_TYPE_LABELS, TRAILER_OFF_PAPERWORK, humanize } from "@/lib/constants";
import {
  CHART_MONTHS, CHART_WEEKS, MIN_DISTANCE_TO_COMPARE, REPEAT_IGNORED_SYSTEMS, REPEAT_VISITS, REPEAT_WINDOW_DAYS,
  burnsHigh, daysBetween, monthBuckets, periodRange, ratio, share, shiftDays, weekBuckets, type Bucket, type ReportPeriod,
} from "./shared";

/*
 * Everything on the reports page for one period, in the company's units and time zone. The CSV export reads the same
 * data. Money is always computed here; the page and the export only show it to roles with money.view.
 *
 * Conventions: a repair order's amount is its cost (falling back to the invoice total when no cost was entered);
 * voided and cancelled orders never count; maintenance spend is completed orders by completion date.
 */

const DAY = 86_400_000;
/** A document expiring within 30 days needs its renewal booked (same window as the compliance tab). */
const EXPIRING_DAYS = 30;
const NO_VENDOR = "No vendor recorded";
const ACTIVE_RO = ["DRAFT", "OPEN", "IN_PROGRESS"];

type Money = { cost: number; invoiceTotal: number | null };
/** What a repair order cost: its cost, or the invoice total when no cost was entered. */
export const roAmount = (w: Money) => (w.cost > 0 ? w.cost : (w.invoiceTotal ?? 0));
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
const unitOf = (w: { truck: { id: string; unitNumber: string } | null; trailer: { id: string; unitNumber: string } | null }) =>
  w.truck ? { type: "truck" as const, id: w.truck.id, unitNumber: w.truck.unitNumber }
    : w.trailer ? { type: "trailer" as const, id: w.trailer.id, unitNumber: w.trailer.unitNumber } : null;
export type UnitRef = NonNullable<ReturnType<typeof unitOf>>;
/** The day a repair order belongs to: completed, else into the shop, else scheduled. */
const roDate = (w: { completedAt: Date | null; inAt: Date | null; scheduledAt: Date }) => w.completedAt ?? w.inAt ?? w.scheduledAt;
const inWindow = (d: Date, from: Date, to: Date) => d >= from && d < to;
/** Repair orders dated in [from, to) (see roDate). */
const datedIn = (from: Date, to: Date): Prisma.WorkOrderWhereInput => ({
  OR: [
    { completedAt: { gte: from, lt: to } },
    { completedAt: null, inAt: { gte: from, lt: to } },
    { completedAt: null, inAt: null, scheduledAt: { gte: from, lt: to } },
  ],
});
const LIVE: Prisma.WorkOrderWhereInput = { voidedAt: null, status: { not: "CANCELLED" } };
const UNIT_SELECT = { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } } } as const;

/* ------------------------------------------------------------------ */
/* Row types                                                           */
/* ------------------------------------------------------------------ */

export type TruckRow = TruckCostRow & { economy: number | null };
export type RepairTypeRow = { type: string; label: string; jobs: number; cost: number; share: number; avg: number; avgShopDays: number | null };
export type VendorRow = { key: string; vendorId: string | null; label: string; jobs: number; jobShare: number; cost: number; share: number; avg: number };
export type SystemRow = { system: string; label: string; lines: number; orders: number; units: number; amount: number; share: number };
export type RepeatRow = {
  key: string; unit: UnitRef; system: string; label: string;
  /** Visits in the period plus the 90 days before it. */
  visits: number;
  /** Most visits inside one 90-day stretch that ends in the period. */
  within: number;
  /** Shortest gap between two visits, days. */
  gapDays: number;
  last: Date;
  orders: { id: string; number: number }[];
  amount: number;
};
export type DriverChargeRow = {
  driverId: string | null; name: string; charges: number; told: number; notTold: number; amount: number; notToldAmount: number;
  /** Oldest charge the driver has not been told about. */
  oldestNotTold: { id: string; number: number; at: Date } | null;
};
export type WarrantyRow = {
  id: string; number: number; title: string; unit: UnitRef | null; vendor: string | null; status: string; stage: string | null;
  opened: Date; completedAt: Date | null; daysOpen: number; amount: number; open: boolean;
};
export type WeekDefects = Bucket & { found: number; closed: number };
export type WeekWalks = Bucket & { expected: number; received: number; reviewed: number; issues: number; missing: number; rate: number | null };
export type RoadsideRow = {
  id: string; at: Date; reportNumber: string | null; level: number; levelLabel: string; place: string | null;
  driver: { id: string; name: string } | null; unit: UnitRef | null; result: string; status: string;
  violations: number; oosViolations: number; oos: boolean; correctionDueAt: Date | null;
};
export type LevelRow = { level: number; label: string; inspections: number; violations: number; oos: number };
export type MonthRow = Bucket & { maintenance: number; jobs: number; fuel: number; volume: number; fills: number };
type DocState = "expired" | "expiring" | "missing" | "ok";
export type PaperworkGroup = { key: "trucks" | "trailers" | "drivers"; label: string; checks: string; href: string; total: number } & Record<DocState, number>;

/* ------------------------------------------------------------------ */
/* Paperwork today (documents as they stand now, whatever the period)  */
/* ------------------------------------------------------------------ */

const RANK: Record<DocState, number> = { expired: 0, expiring: 1, missing: 2, ok: 3 };
const worstOf = (states: DocState[]) => states.reduce<DocState>((w, s) => (RANK[s] < RANK[w] ? s : w), "ok");
const blank = (): Record<DocState, number> => ({ expired: 0, expiring: 0, missing: 0, ok: 0 });
const stateByDate = (d: Date | null, now: number): DocState => {
  if (!d) return "ok";
  const days = Math.ceil((d.getTime() - now) / DAY);
  return days < 0 ? "expired" : days <= EXPIRING_DAYS ? "expiring" : "ok";
};

async function paperworkToday(now: number) {
  const [trucks, trailers, drivers, docs] = await Promise.all([
    db.truck.findMany({ where: { status: { not: "INACTIVE" } }, select: { id: true, insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true } }),
    db.trailer.findMany({ where: { status: { notIn: TRAILER_OFF_PAPERWORK } }, select: { id: true, insuranceExpiry: true, inspectionExpiry: true } }),
    db.driver.findMany({ where: { status: { not: "INACTIVE" } }, select: { licenseExpiry: true, medicalExpiry: true } }),
    db.document.findMany({
      where: { OR: [{ truckId: { not: null } }, { trailerId: { not: null } }], kind: { in: [...REQUIRED_UNIT_DOCS] } },
      select: { truckId: true, trailerId: true, kind: true, expiresAt: true },
    }),
  ]);
  // Latest expiry per unit + kind; a file without an expiry never expires.
  const latest = new Map<string, Date | null>();
  for (const d of docs) {
    const key = `${d.truckId ?? d.trailerId}:${d.kind}`;
    if (!latest.has(key)) { latest.set(key, d.expiresAt); continue; }
    const cur = latest.get(key);
    if (cur === null) continue;
    if (d.expiresAt === null || (cur && d.expiresAt > cur)) latest.set(key, d.expiresAt);
  }
  const unitState = (id: string, recorded: Record<string, Date | null>) => worstOf(REQUIRED_UNIT_DOCS.map((kind) => {
    const key = `${id}:${kind}`;
    const onFile = latest.has(key);
    const byDate = stateByDate(onFile ? (latest.get(key) ?? recorded[kind] ?? null) : (recorded[kind] ?? null), now);
    // Not on file: an expired or expiring recorded date outranks "missing" because the renewal is the real problem.
    return onFile ? byDate : byDate === "ok" ? "missing" : byDate;
  }));
  const truckCounts = blank();
  for (const t of trucks) truckCounts[unitState(t.id, { REGISTRATION: t.registrationExpiry, INSURANCE: t.insuranceExpiry, INSPECTION: t.inspectionExpiry })]++;
  const trailerCounts = blank();
  for (const t of trailers) trailerCounts[unitState(t.id, { INSURANCE: t.insuranceExpiry, INSPECTION: t.inspectionExpiry })]++;
  const driverCounts = blank();
  for (const d of drivers) driverCounts[worstOf([stateByDate(d.licenseExpiry, now), d.medicalExpiry ? stateByDate(d.medicalExpiry, now) : "missing"])]++;
  const groups: PaperworkGroup[] = [
    { key: "trucks", label: "Trucks", checks: "Registration, insurance and annual inspection", href: "/maintenance?tab=compliance", total: trucks.length, ...truckCounts },
    { key: "trailers", label: "Trailers", checks: "Registration, insurance and annual inspection", href: "/maintenance?tab=compliance", total: trailers.length, ...trailerCounts },
    { key: "drivers", label: "Drivers", checks: "Driving licence and medical certificate expiry dates", href: "/drivers", total: drivers.length, ...driverCounts },
  ];
  return { groups, trucksInService: trucks.length };
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

/**
 * `money`: whether the viewer may see money. Without it the money figures are still computed (and never rendered or
 * exported), but nothing is ordered by cost either, so a ranking cannot give the spend away.
 */
export async function reportData(period: ReportPeriod, locale: CompanyLocale, opts: { money: boolean }, now = new Date()) {
  const f = makeFormat(locale);
  const tz = locale.timezone;
  const nowMs = now.getTime();
  const range = periodRange(period, locale, now);
  const { from, to, prevFrom, prevTo } = range;
  const months = monthBuckets(CHART_MONTHS[period], locale, now);
  const weeks = weekBuckets(CHART_WEEKS[period], locale, now);
  const repeatFrom = new Date(from.getTime() - REPEAT_WINDOW_DAYS * DAY);
  const doneIn = (a: Date, b: Date): Prisma.WorkOrderWhereInput => ({ status: "DONE", voidedAt: null, completedAt: { gte: a, lt: b } });

  const drivenP = kmDriven(from, to);
  const prevDrivenP = kmDriven(prevFrom, prevTo);

  const [
    driven, prevDriven, trucks, prevTrucks, downtime, prevDowntime, done, prevDone, monthWork, monthFuel, paperwork,
    lines, charges, warranty, defects, walks, trucksWithDriver, roadside, prevRoadside, openCorrections,
  ] = await Promise.all([
    drivenP,
    prevDrivenP,
    drivenP.then((d) => truckCosts(from, to, d)),
    prevDrivenP.then((d) => truckCosts(prevFrom, prevTo, d)),
    shopDowntime(from, to),
    shopDowntime(prevFrom, prevTo),
    db.workOrder.findMany({
      where: doneIn(from, to),
      select: { id: true, repairType: true, cost: true, invoiceTotal: true, inAt: true, outAt: true, vendor: true, vendorId: true, vendorRef: { select: { name: true } } },
    }),
    db.workOrder.findMany({ where: doneIn(prevFrom, prevTo), select: { cost: true, invoiceTotal: true } }),
    db.workOrder.findMany({ where: doneIn(months[0].from, now), select: { completedAt: true, cost: true, invoiceTotal: true } }),
    db.fuelLog.findMany({ where: { date: { gte: months[0].from, lt: now } }, select: { date: true, cost: true, liters: true } }),
    paperworkToday(nowMs),
    db.workOrderLine.findMany({
      where: { workOrder: { ...LIVE, ...datedIn(repeatFrom, to) } },
      take: 20_000,
      select: {
        system: true, amount: true,
        workOrder: { select: { id: true, number: true, status: true, completedAt: true, inAt: true, scheduledAt: true, ...UNIT_SELECT } },
      },
    }),
    db.workOrder.findMany({
      where: { ...LIVE, payer: "DRIVER" }, take: 5000, orderBy: { scheduledAt: "asc" },
      select: { id: true, number: true, cost: true, invoiceTotal: true, driverInformedAt: true, completedAt: true, inAt: true, scheduledAt: true, chargeDriver: { select: { id: true, name: true } } },
    }),
    db.workOrder.findMany({
      where: { ...LIVE, payer: "WARRANTY", OR: [{ status: { in: ACTIVE_RO } }, { completedAt: { gte: from, lt: to } }] }, take: 2000, orderBy: { scheduledAt: "asc" },
      select: {
        id: true, number: true, title: true, status: true, stage: true, cost: true, invoiceTotal: true, completedAt: true, inAt: true, scheduledAt: true,
        vendor: true, vendorRef: { select: { name: true } }, ...UNIT_SELECT,
      },
    }),
    db.defect.findMany({
      where: { OR: [{ foundAt: { gte: weeks[0].from } }, { closedAt: { gte: weeks[0].from } }, { foundAt: { gte: from } }, { status: { not: "CLOSED" } }] },
      take: 20_000,
      select: { foundAt: true, closedAt: true, status: true, holdsUnit: true, dueAt: true, truckId: true },
    }),
    db.walkAround.findMany({ where: { weekStart: { gte: dateOnly(weeks[0].key) } }, select: { weekStart: true, truckId: true, driverId: true, video: true, reviewedAt: true, result: true } }),
    db.truck.count({ where: { status: { not: "INACTIVE" }, driverId: { not: null } } }),
    db.roadsideInspection.findMany({
      where: { inspectedAt: { gte: from, lt: to } }, orderBy: { inspectedAt: "desc" }, take: 5000,
      select: {
        id: true, inspectedAt: true, reportNumber: true, level: true, state: true, location: true, result: true, status: true, correctionDueAt: true,
        driver: { select: { id: true, name: true } }, ...UNIT_SELECT, violations: { select: { oos: true } },
      },
    }),
    db.roadsideInspection.findMany({ where: { inspectedAt: { gte: prevFrom, lt: prevTo } }, select: { result: true, violations: { select: { oos: true } } } }),
    db.roadsideInspection.findMany({ where: { status: "OPEN" }, select: { correctionDueAt: true } }),
  ]);

  /* Running costs and distance ----------------------------------- */
  const spend = sum(done, roAmount);
  const prevSpend = sum(prevDone, roAmount);
  const fuel = trucks.totals.fuel;
  const prevFuel = prevTrucks.totals.fuel;
  const distance = driven.total;
  const prevDistance = prevDriven.total;
  const running = spend + fuel;

  const withEconomy = (rows: TruckCostRow[]): TruckRow[] => rows.map((r) => ({ ...r, economy: f.economy(r.km, r.liters) }));
  const truckRows = withEconomy(trucks.rows);
  // Fleet economy only over trucks with both fuel and distance, so a truck without readings does not skew it.
  const fleetEconomy = (rows: TruckCostRow[]) => {
    const measured = rows.filter((r) => r.km > 0 && r.liters > 0);
    return { value: f.economy(sum(measured, (r) => r.km), sum(measured, (r) => r.liters)), measured: measured.length };
  };
  const economy = fleetEconomy(trucks.rows);
  const prevEconomy = fleetEconomy(prevTrucks.rows);
  const worseBurn = economy.value == null ? 0
    : truckRows.filter((r) => r.economy != null && r.km >= MIN_DISTANCE_TO_COMPARE && burnsHigh(r.economy, economy.value!, f.labels.economyHigherIsBetter)).length;
  const truckCapacity = paperwork.trucksInService * downtime.windowDays;

  /* Defects (counts in the period, and now) ------------------------ */
  const closedInPeriod = defects.filter((d) => d.closedAt && inWindow(d.closedAt, from, to));
  const avgDaysToClose = closedInPeriod.length ? sum(closedInPeriod, (d) => daysBetween(d.foundAt, d.closedAt!)) / closedInPeriod.length : null;
  const openDefects = defects.filter((d) => d.status !== "CLOSED");
  const defectSummary = {
    found: defects.filter((d) => inWindow(d.foundAt, from, to)).length,
    closed: closedInPeriod.length,
    avgDaysToClose: avgDaysToClose == null ? null : Math.round(avgDaysToClose * 10) / 10,
    open: openDefects.filter((d) => d.status === "OPEN").length,
    toConfirm: openDefects.filter((d) => d.status === "REPAIRED").length,
    holdingTrucks: new Set(openDefects.filter((d) => d.holdsUnit && d.truckId).map((d) => d.truckId)).size,
    overdue: openDefects.filter((d) => d.status === "OPEN" && d.dueAt && d.dueAt.getTime() < nowMs).length,
  };
  const defectWeeks: WeekDefects[] = weeks.map((w) => ({
    ...w,
    found: defects.filter((d) => inWindow(d.foundAt, w.from, w.to)).length,
    closed: defects.filter((d) => d.closedAt && inWindow(d.closedAt, w.from, w.to)).length,
  }));

  /* Walk-around compliance per week -------------------------------- */
  const walkWeeks: WeekWalks[] = weeks.map((w) => {
    const rows = walks.filter((r) => r.weekStart.toISOString().slice(0, 10) === w.key);
    const received = rows.filter((r) => r.video === "RECEIVED").length;
    // Trucks with a driver today; a week with more trucks on record than that counts those instead.
    const expected = Math.max(trucksWithDriver, rows.filter((r) => r.driverId != null || r.video === "RECEIVED").length);
    return {
      ...w, expected, received,
      reviewed: rows.filter((r) => r.reviewedAt != null).length,
      issues: rows.filter((r) => r.result === "ISSUES").length,
      missing: rows.filter((r) => r.video === "MISSING").length,
      rate: expected > 0 ? Math.min(1, received / expected) : null,
    };
  });
  const walkSummary = (() => {
    const past = walkWeeks.filter((w) => !w.partial && w.expected > 0);
    const current = walkWeeks[walkWeeks.length - 1];
    const exp = sum(past, (w) => w.expected);
    // The week's videos are due by the end of its last day.
    const dueAt = new Date(shiftDays(current.from, 7, tz).getTime() - 1);
    return { average: exp > 0 ? Math.min(1, sum(past, (w) => w.received) / exp) : null, current, dueAt, trucksWithDriver };
  })();

  /* Roadside inspections ------------------------------------------- */
  const isOos = (r: { result: string; violations: { oos: boolean }[] }) => r.result === "OOS" || r.violations.some((v) => v.oos);
  const roadsideRows: RoadsideRow[] = roadside.map((r) => ({
    id: r.id, at: r.inspectedAt, reportNumber: r.reportNumber, level: r.level, levelLabel: INSPECTION_LEVEL_LABELS[r.level] ?? `Level ${r.level}`,
    place: [r.location, r.state].filter(Boolean).join(", ") || null, driver: r.driver, unit: unitOf(r), result: r.result, status: r.status,
    violations: r.violations.length, oosViolations: r.violations.filter((v) => v.oos).length, oos: isOos(r), correctionDueAt: r.correctionDueAt,
  }));
  const levels = new Map<number, LevelRow>();
  for (const r of roadsideRows) {
    const l = levels.get(r.level) ?? { level: r.level, label: r.levelLabel, inspections: 0, violations: 0, oos: 0 };
    l.inspections++; l.violations += r.violations; if (r.oos) l.oos++;
    levels.set(r.level, l);
  }
  const prevOos = prevRoadside.filter(isOos).length;
  const roadsideSummary = {
    inspections: roadsideRows.length,
    prevInspections: prevRoadside.length,
    clean: roadsideRows.filter((r) => r.violations === 0 && r.result === "CLEAN").length,
    withViolations: roadsideRows.filter((r) => r.violations > 0 || r.result !== "CLEAN").length,
    violations: sum(roadsideRows, (r) => r.violations),
    oos: roadsideRows.filter((r) => r.oos).length,
    oosRate: ratio(roadsideRows.filter((r) => r.oos).length, roadsideRows.length),
    prevOosRate: ratio(prevOos, prevRoadside.length),
    openCorrections: openCorrections.length,
    overdueCorrections: openCorrections.filter((c) => c.correctionDueAt && c.correctionDueAt.getTime() < nowMs).length,
  };

  /* KPIs ----------------------------------------------------------- */
  const kpis = {
    maintenance: { value: spend, prev: prevSpend, jobs: done.length, prevJobs: prevDone.length },
    fuel: { value: fuel, prev: prevFuel, volume: trucks.totals.liters, prevVolume: prevTrucks.totals.liters, fills: trucks.totals.fills, perVolume: ratio(fuel, trucks.totals.liters) },
    distance: { value: distance, prev: prevDistance, trucks: truckRows.filter((r) => r.km > 0).length, withoutReadings: trucks.totals.withoutKm },
    costPerDistance: { value: ratio(running, distance), prev: ratio(prevSpend + prevFuel, prevDistance), maintenance: ratio(spend, distance), fuel: ratio(fuel, distance) },
    economy: { value: economy.value, prev: prevEconomy.value, measured: economy.measured, worse: worseBurn },
    downtime: {
      value: downtime.days, prev: prevDowntime.days, units: downtime.rows.length, inShopNow: downtime.inShopNow,
      /** Share of truck-days in service that were not spent in the shop. */
      availability: truckCapacity > 0 ? Math.max(0, Math.min(100, Math.round((1 - downtime.truckDays / truckCapacity) * 1000) / 10)) : null,
    },
  };

  /* Repairs by type ------------------------------------------------ */
  const byType = new Map<string, { jobs: number; cost: number; shopDays: number; timed: number }>();
  for (const w of done) {
    const e = byType.get(w.repairType) ?? { jobs: 0, cost: 0, shopDays: 0, timed: 0 };
    e.jobs++; e.cost += roAmount(w);
    if (w.inAt && w.outAt && w.outAt > w.inAt) { e.shopDays += daysBetween(w.inAt, w.outAt); e.timed++; }
    byType.set(w.repairType, e);
  }
  const repairTypes: RepairTypeRow[] = [...byType]
    .map(([type, e]) => ({
      type, label: REPAIR_TYPE_LABELS[type] ?? humanize(type), jobs: e.jobs, cost: e.cost, share: share(e.cost, spend), avg: e.jobs ? e.cost / e.jobs : 0,
      avgShopDays: e.timed ? Math.round((e.shopDays / e.timed) * 10) / 10 : null,
    }))
    .sort((a, b) => b.cost - a.cost || b.jobs - a.jobs);

  /* Vendors -------------------------------------------------------- */
  const byVendor = new Map<string, { vendorId: string | null; label: string; jobs: number; cost: number }>();
  for (const w of done) {
    const name = w.vendorRef?.name ?? w.vendor?.trim() ?? "";
    const key = w.vendorId ? `id:${w.vendorId}` : name ? `name:${name.toLowerCase()}` : "none";
    const e = byVendor.get(key) ?? { vendorId: w.vendorId, label: name || NO_VENDOR, jobs: 0, cost: 0 };
    e.jobs++; e.cost += roAmount(w);
    byVendor.set(key, e);
  }
  const vendors: VendorRow[] = [...byVendor]
    .map(([key, e]) => ({ key, ...e, jobShare: share(e.jobs, done.length), share: share(e.cost, spend), avg: e.jobs ? e.cost / e.jobs : 0 }))
    .sort((a, b) => b.cost - a.cost || b.jobs - a.jobs);

  /* Repairs by system (completed in the period) -------------------- */
  const doneLines = lines.filter((l) => l.workOrder.status === "DONE" && l.workOrder.completedAt && l.workOrder.completedAt >= from);
  const lineTotal = sum(doneLines, (l) => l.amount);
  const bySystem = new Map<string, { lines: number; orders: Set<string>; units: Set<string>; amount: number }>();
  for (const l of doneLines) {
    const e = bySystem.get(l.system) ?? { lines: 0, orders: new Set<string>(), units: new Set<string>(), amount: 0 };
    e.lines++; e.amount += l.amount; e.orders.add(l.workOrder.id);
    const u = unitOf(l.workOrder);
    if (u) e.units.add(u.id);
    bySystem.set(l.system, e);
  }
  const systems: SystemRow[] = [...bySystem]
    .map(([system, e]) => ({ system, label: REPAIR_SYSTEM_LABELS[system] ?? humanize(system), lines: e.lines, orders: e.orders.size, units: e.units.size, amount: e.amount, share: share(e.amount, lineTotal) }))
    .sort((a, b) => b.orders - a.orders || b.amount - a.amount);

  /* Repeat repairs: same unit, same system, twice within 90 days --- */
  const visits = new Map<string, { unit: UnitRef; system: string; orders: Map<string, { id: string; number: number; at: Date; amount: number }> }>();
  for (const l of lines) {
    if ((REPEAT_IGNORED_SYSTEMS as readonly string[]).includes(l.system)) continue;
    const unit = unitOf(l.workOrder);
    if (!unit) continue;
    const key = `${unit.id}:${l.system}`;
    const v = visits.get(key) ?? { unit, system: l.system, orders: new Map() };
    const o = v.orders.get(l.workOrder.id) ?? { id: l.workOrder.id, number: l.workOrder.number, at: roDate(l.workOrder), amount: 0 };
    o.amount += l.amount;
    v.orders.set(l.workOrder.id, o);
    visits.set(key, v);
  }
  const windowMs = REPEAT_WINDOW_DAYS * DAY;
  const repeats: RepeatRow[] = [];
  for (const [key, v] of visits) {
    const orders = [...v.orders.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
    if (orders.length < REPEAT_VISITS) continue;
    let within = 0;
    for (const o of orders) {
      if (o.at < from) continue;
      const n = orders.filter((x) => x.at.getTime() <= o.at.getTime() && x.at.getTime() >= o.at.getTime() - windowMs).length;
      within = Math.max(within, n);
    }
    if (within < REPEAT_VISITS) continue;
    let gap = Infinity;
    for (let i = 1; i < orders.length; i++) gap = Math.min(gap, daysBetween(orders[i - 1].at, orders[i].at));
    repeats.push({
      key, unit: v.unit, system: v.system, label: REPAIR_SYSTEM_LABELS[v.system] ?? humanize(v.system),
      visits: orders.length, within, gapDays: Math.round(gap), last: orders[orders.length - 1].at,
      orders: orders.map((o) => ({ id: o.id, number: o.number })), amount: sum(orders, (o) => o.amount),
    });
  }
  repeats.sort((a, b) => b.within - a.within || a.gapDays - b.gapDays || b.last.getTime() - a.last.getTime());

  /* Driver charges ------------------------------------------------- */
  const chargesInPeriod = charges.filter((c) => inWindow(roDate(c), from, to));
  const byDriver = new Map<string, DriverChargeRow>();
  for (const c of chargesInPeriod) {
    const key = c.chargeDriver?.id ?? "none";
    const e = byDriver.get(key) ?? { driverId: c.chargeDriver?.id ?? null, name: c.chargeDriver?.name ?? "No driver picked", charges: 0, told: 0, notTold: 0, amount: 0, notToldAmount: 0, oldestNotTold: null };
    const amount = roAmount(c);
    e.charges++; e.amount += amount;
    if (c.driverInformedAt) e.told++;
    else {
      e.notTold++; e.notToldAmount += amount;
      if (!e.oldestNotTold) e.oldestNotTold = { id: c.id, number: c.number, at: roDate(c) };
    }
    byDriver.set(key, e);
  }
  const driverCharges = [...byDriver.values()].sort((a, b) => b.notTold - a.notTold || b.charges - a.charges || b.amount - a.amount || a.name.localeCompare(b.name));
  const untold = charges.filter((c) => !c.driverInformedAt);
  const chargeSummary = {
    charges: chargesInPeriod.length, told: sum(driverCharges, (d) => d.told), notTold: sum(driverCharges, (d) => d.notTold),
    amount: sum(driverCharges, (d) => d.amount), notToldAmount: sum(driverCharges, (d) => d.notToldAmount),
    /** Across every date: charges nobody has told the driver about yet. */
    untoldAll: untold.length, untoldAllAmount: sum(untold, roAmount),
  };

  /* Warranty claims ------------------------------------------------ */
  const warrantyRows: WarrantyRow[] = warranty
    .map((w) => {
      const opened = w.inAt ?? w.scheduledAt;
      const open = ACTIVE_RO.includes(w.status);
      return {
        id: w.id, number: w.number, title: w.title, unit: unitOf(w), vendor: w.vendorRef?.name ?? w.vendor, status: w.status, stage: w.stage,
        opened, completedAt: w.completedAt, daysOpen: Math.floor(daysBetween(opened, open ? now : (w.completedAt ?? now))), amount: roAmount(w), open,
      };
    })
    .sort((a, b) => Number(b.open) - Number(a.open) || b.daysOpen - a.daysOpen);
  const warrantySummary = {
    open: warrantyRows.filter((w) => w.open).length,
    openAmount: sum(warrantyRows.filter((w) => w.open), (w) => w.amount),
    completed: warrantyRows.filter((w) => !w.open).length,
    completedAmount: sum(warrantyRows.filter((w) => !w.open), (w) => w.amount),
  };

  /* Running costs per month (company calendar) --------------------- */
  const monthKey = (d: Date) => dayKey(d, tz).slice(0, 7);
  const monthly: MonthRow[] = months.map((m) => ({ ...m, maintenance: 0, jobs: 0, fuel: 0, volume: 0, fills: 0 }));
  const byMonth = new Map(monthly.map((m) => [m.key, m]));
  for (const w of monthWork) {
    const m = w.completedAt ? byMonth.get(monthKey(w.completedAt)) : undefined;
    if (m) { m.maintenance += roAmount(w); m.jobs++; }
  }
  for (const x of monthFuel) {
    const m = byMonth.get(monthKey(x.date));
    if (m) { m.fuel += x.cost; m.volume += x.liters; m.fills++; }
  }

  if (!opts.money) {
    truckRows.sort((a, b) => b.km - a.km || b.jobs - a.jobs || a.unitNumber.localeCompare(b.unitNumber));
    repairTypes.sort((a, b) => b.jobs - a.jobs || a.label.localeCompare(b.label));
    vendors.sort((a, b) => b.jobs - a.jobs || a.label.localeCompare(b.label));
    systems.sort((a, b) => b.orders - a.orders || b.lines - a.lines || a.label.localeCompare(b.label));
    driverCharges.sort((a, b) => b.notTold - a.notTold || b.charges - a.charges || a.name.localeCompare(b.name));
  }

  return {
    period, range, kpis, monthly,
    trucks: truckRows, truckTotals: { ...trucks.totals, economy: economy.value }, trailerWork: trucks.trailers,
    running: { maintenance: spend, fuel, total: running },
    repairTypes, vendors, systems, lineTotal, repeats,
    downtime: downtime.rows,
    driverCharges, chargeSummary,
    warranty: warrantyRows, warrantySummary,
    defectWeeks, defectSummary,
    walkWeeks, walkSummary,
    roadside: roadsideRows, roadsideLevels: [...levels.values()].sort((a, b) => a.level - b.level), roadsideSummary,
    paperwork: paperwork.groups,
  };
}
export type ReportData = Awaited<ReturnType<typeof reportData>>;
