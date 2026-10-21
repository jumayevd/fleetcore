import "server-only";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { db } from "./db";
import { kmDriven } from "./mileage";

/*
 * Fleet analytics shared by Maintenance, Reports and the overview. Distances come from odometer readings (kmDriven);
 * maintenance spend is completed work orders by completion date; fuel spend is logged fills by fill date.
 */

const DAY = 86_400_000;
/** Same wording as the maintenance pages use for a work order without a vendor. */
const NO_VENDOR = "No vendor recorded";

/** What `kmDriven` returns; pass it in when a page already computed it for the same window. */
export type Driven = Awaited<ReturnType<typeof kmDriven>>;

const round2 = (v: number) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ */
/* Maintenance analytics                                               */
/* ------------------------------------------------------------------ */

/**
 * Completed work in [from, to): spend, cost per km driven (odometer based), spend by vendor / category / unit, and the
 * units that cost far more than the median. `open` is what is in the shop right now.
 */
export async function maintenanceSummary(from: Date, to: Date, driven?: Driven) {
  const [done, open, km] = await Promise.all([
    db.workOrder.findMany({ where: { status: "DONE", completedAt: { gte: from, lt: to } }, include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { unitNumber: true } } } }),
    db.workOrder.findMany({ where: { status: "IN_PROGRESS" }, include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { unitNumber: true } } } }),
    driven ? driven.total : kmDriven(from, to).then((d) => d.total),
  ]);
  const spend = done.reduce((a, w) => a + w.cost, 0);
  const group = <K extends string>(key: (w: (typeof done)[number]) => K) => {
    const m = new Map<K, { count: number; cost: number }>();
    for (const w of done) { const k = key(w); const e = m.get(k) ?? { count: 0, cost: 0 }; e.count++; e.cost += w.cost; m.set(k, e); }
    return [...m].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost);
  };
  const perUnit = group((w) => w.truck?.unitNumber ?? w.trailer?.unitNumber ?? "—");
  const median = perUnit.length ? [...perUnit].sort((a, b) => a.cost - b.cost)[Math.floor(perUnit.length / 2)].cost : 0;
  return {
    spend, records: done.length, km, costPerKm: km ? spend / km : 0,
    openCount: open.length, open,
    byVendor: group((w) => w.vendor ?? NO_VENDOR).slice(0, 8),
    byCategory: group((w) => w.category),
    perUnit, median,
    flagged: perUnit.filter((u) => u.cost > median * 1.8 && u.cost > 500),
  };
}

/* ------------------------------------------------------------------ */
/* Running costs per month                                             */
/* ------------------------------------------------------------------ */

export type MonthSpend = {
  /** yyyy-MM */
  key: string;
  /** "Oct 26" */
  label: string;
  from: Date;
  to: Date;
  /** The current month, which runs to now. */
  partial: boolean;
  maintenance: number;
  jobs: number;
  fuel: number;
  liters: number;
  fills: number;
};

/**
 * Maintenance (completed work orders) and fuel (logged fills) per calendar month, oldest first, for the last `months`
 * months including the current one (which runs to `now`).
 */
export async function monthlyFleetSpend(months = 6, now = new Date()): Promise<MonthSpend[]> {
  const start = startOfMonth(subMonths(now, months - 1));
  const [work, fuel] = await Promise.all([
    db.workOrder.findMany({ where: { status: "DONE", completedAt: { gte: start, lt: now } }, select: { completedAt: true, cost: true } }),
    db.fuelLog.findMany({ where: { date: { gte: start, lt: now } }, select: { date: true, cost: true, liters: true } }),
  ]);
  const buckets: MonthSpend[] = Array.from({ length: months }, (_, i) => {
    const from = addMonths(start, i);
    const last = i === months - 1;
    return { key: format(from, "yyyy-MM"), label: format(from, "MMM yy"), from, to: last ? now : addMonths(start, i + 1), partial: last, maintenance: 0, jobs: 0, fuel: 0, liters: 0, fills: 0 };
  });
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const w of work) {
    const b = w.completedAt ? byKey.get(format(w.completedAt, "yyyy-MM")) : undefined;
    if (b) { b.maintenance += w.cost; b.jobs++; }
  }
  for (const f of fuel) {
    const b = byKey.get(format(f.date, "yyyy-MM"));
    if (b) { b.fuel += f.cost; b.liters += f.liters; b.fills++; }
  }
  return buckets.map((b) => ({ ...b, maintenance: round2(b.maintenance), fuel: round2(b.fuel), liters: Math.round(b.liters) }));
}

/* ------------------------------------------------------------------ */
/* Cost per truck                                                      */
/* ------------------------------------------------------------------ */

export type TruckCostRow = {
  id: string;
  unitNumber: string;
  model: string;
  status: string;
  group: string | null;
  km: number;
  fuel: number;
  liters: number;
  fills: number;
  maintenance: number;
  jobs: number;
  /** fuel + maintenance */
  total: number;
  /** total ÷ km; null without km. */
  costPerKm: number | null;
  /** litres ÷ km × 100; null without both. */
  l100: number | null;
};

/**
 * Fuel, maintenance and km driven per truck in [from, to). Every truck in service is listed (retired ones only when
 * they cost something in the window), most expensive first. Trailer work is returned separately: trailers burn no fuel
 * and log no km, but their work is part of the fleet's maintenance spend.
 */
export async function truckCosts(from: Date, to: Date, driven?: Driven) {
  const [trucks, work, trailerWork, fuel, km] = await Promise.all([
    db.truck.findMany({ select: { id: true, unitNumber: true, make: true, model: true, status: true, group: true }, orderBy: { unitNumber: "asc" } }),
    db.workOrder.groupBy({ by: ["truckId"], where: { status: "DONE", completedAt: { gte: from, lt: to }, truckId: { not: null } }, _sum: { cost: true }, _count: { _all: true } }),
    db.workOrder.aggregate({ where: { status: "DONE", completedAt: { gte: from, lt: to }, truckId: null, trailerId: { not: null } }, _sum: { cost: true }, _count: { _all: true } }),
    db.fuelLog.groupBy({ by: ["truckId"], where: { date: { gte: from, lt: to } }, _sum: { cost: true, liters: true }, _count: { _all: true } }),
    driven ?? kmDriven(from, to),
  ]);
  const workBy = new Map(work.map((w) => [w.truckId, w]));
  const fuelBy = new Map(fuel.map((f) => [f.truckId, f]));
  const rows: TruckCostRow[] = trucks
    .map((t) => {
      const w = workBy.get(t.id);
      const f = fuelBy.get(t.id);
      const run = km.byTruck.get(t.id) ?? 0;
      const maintenance = w?._sum.cost ?? 0;
      const fuelCost = f?._sum.cost ?? 0;
      const liters = f?._sum.liters ?? 0;
      const total = maintenance + fuelCost;
      return {
        id: t.id, unitNumber: t.unitNumber, model: `${t.make} ${t.model}`, status: t.status, group: t.group,
        km: run, fuel: fuelCost, liters, fills: f?._count._all ?? 0, maintenance, jobs: w?._count._all ?? 0, total,
        costPerKm: run > 0 ? total / run : null,
        l100: run > 0 && liters > 0 ? (liters / run) * 100 : null,
      };
    })
    .filter((r) => r.status !== "INACTIVE" || r.total > 0 || r.km > 0)
    .sort((a, b) => b.total - a.total || b.km - a.km || a.unitNumber.localeCompare(b.unitNumber));

  const sum = (f: (r: TruckCostRow) => number, xs = rows) => xs.reduce((a, r) => a + f(r), 0);
  // Fleet fuel economy only over trucks with both litres and km, so a truck without readings does not skew it.
  const measured = rows.filter((r) => r.l100 != null);
  const measuredKm = sum((r) => r.km, measured);
  const totals = {
    km: sum((r) => r.km), fuel: sum((r) => r.fuel), liters: sum((r) => r.liters), fills: sum((r) => r.fills),
    maintenance: sum((r) => r.maintenance), jobs: sum((r) => r.jobs), total: sum((r) => r.total),
    l100: measuredKm > 0 ? (sum((r) => r.liters, measured) / measuredKm) * 100 : null,
    /** Active trucks with no km recorded in the window (fewer than two odometer readings to compare). */
    withoutKm: rows.filter((r) => r.status === "ACTIVE" && r.km === 0).length,
  };
  const trailers = { maintenance: trailerWork._sum.cost ?? 0, jobs: trailerWork._count._all };
  return { rows, totals, trailers };
}

/* ------------------------------------------------------------------ */
/* Shop downtime                                                       */
/* ------------------------------------------------------------------ */

export type DowntimeRow = {
  unitId: string;
  type: "truck" | "trailer";
  unitNumber: string;
  /** Days in the shop inside the window (overlapping jobs on the unit count once), one decimal. */
  days: number;
  jobs: number;
  /** A job is in progress right now. */
  inShopNow: boolean;
  /** The job with the most shop time inside the window. */
  longest: { id: string; number: number; title: string; days: number };
};

/**
 * Time units spent in the shop in [from, to), from work orders' in / out times (a job still in progress counts to
 * now). Busiest units first.
 */
export async function shopDowntime(from: Date, to: Date) {
  const now = Date.now();
  const start = from.getTime();
  const end = Math.min(to.getTime(), now);
  const jobs = await db.workOrder.findMany({
    where: { inAt: { not: null, lt: to }, status: { in: ["IN_PROGRESS", "DONE", "CANCELLED"] }, OR: [{ outAt: null }, { outAt: { gt: from } }] },
    select: {
      id: true, number: true, title: true, status: true, inAt: true, outAt: true, truckId: true, trailerId: true,
      truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } },
    },
  });
  type Acc = Omit<DowntimeRow, "days"> & { spans: [number, number][] };
  const units = new Map<string, Acc>();
  for (const j of jobs) {
    const unitId = j.truckId ?? j.trailerId;
    const unitNumber = j.truck?.unitNumber ?? j.trailer?.unitNumber;
    // Completing or cancelling a started job stamps outAt; only a job still in progress runs to now.
    const out = j.outAt?.getTime() ?? (j.status === "IN_PROGRESS" ? now : null);
    if (!unitId || !unitNumber || !j.inAt || out == null) continue;
    const a = Math.max(j.inAt.getTime(), start);
    const b = Math.min(out, end);
    if (b <= a) continue;
    const days = Math.round(((b - a) / DAY) * 10) / 10;
    const u = units.get(unitId) ?? {
      unitId, type: j.truckId ? "truck" : "trailer", unitNumber, jobs: 0, inShopNow: false,
      longest: { id: j.id, number: j.number, title: j.title, days }, spans: [],
    };
    u.jobs++;
    u.spans.push([a, b]);
    if (j.status === "IN_PROGRESS") u.inShopNow = true;
    if (days > u.longest.days) u.longest = { id: j.id, number: j.number, title: j.title, days };
    units.set(unitId, u);
  }
  const rows: DowntimeRow[] = [...units.values()]
    .map(({ spans, ...u }) => {
      // Merge overlapping jobs so two jobs on one truck at once are one stretch off the road.
      const sorted = spans.sort((x, y) => x[0] - y[0]);
      let ms = 0;
      let [cs, ce] = sorted[0];
      for (const [s, e] of sorted.slice(1)) {
        if (s <= ce) ce = Math.max(ce, e);
        else { ms += ce - cs; [cs, ce] = [s, e]; }
      }
      ms += ce - cs;
      return { ...u, days: Math.round((ms / DAY) * 10) / 10 };
    })
    .sort((a, b) => b.days - a.days || a.unitNumber.localeCompare(b.unitNumber));
  const truckDays = rows.filter((r) => r.type === "truck").reduce((a, r) => a + r.days, 0);
  return {
    rows,
    days: Math.round(rows.reduce((a, r) => a + r.days, 0) * 10) / 10,
    truckDays: Math.round(truckDays * 10) / 10,
    inShopNow: rows.filter((r) => r.inShopNow).length,
    /** Length of the window in days (up to now), for availability. */
    windowDays: Math.max(0, (end - start) / DAY),
  };
}
