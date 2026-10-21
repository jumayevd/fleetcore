import "server-only";
import { endOfDay, format, startOfDay, startOfMonth, subMonths } from "date-fns";
import { db, rootDb } from "@/lib/db";
import { kmDriven } from "@/lib/mileage";

const NOT_STARTED = ["DRAFT", "OPEN"];
const OPEN_WORK = ["DRAFT", "OPEN", "IN_PROGRESS"];

/* ------------------------------------------------------------------ */
/* Today in the shop                                                   */
/* ------------------------------------------------------------------ */

const jobSelect = {
  id: true, number: true, title: true, status: true, priority: true, category: true, vendor: true, scheduledAt: true, inAt: true,
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
} as const;

/**
 * The shop's day: jobs in progress, jobs booked for today, and jobs booked for an earlier day that never started
 * (the same rule as the "overdue work order" alert). Up to `take` of each, plus the totals for "All N" links.
 */
export async function shopToday(now: Date, take = 6) {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const inProgressWhere = { status: "IN_PROGRESS" };
  const todayWhere = { status: { in: NOT_STARTED }, scheduledAt: { gte: dayStart, lte: dayEnd } };
  const overdueWhere = { status: { in: NOT_STARTED }, scheduledAt: { lt: dayStart } };
  const [inProgress, today, overdue, nInProgress, nToday, nOverdue] = await Promise.all([
    db.workOrder.findMany({ where: inProgressWhere, orderBy: [{ inAt: { sort: "asc", nulls: "last" } }, { scheduledAt: "asc" }], take, select: jobSelect }),
    db.workOrder.findMany({ where: todayWhere, orderBy: { scheduledAt: "asc" }, take, select: jobSelect }),
    db.workOrder.findMany({ where: overdueWhere, orderBy: { scheduledAt: "asc" }, take, select: jobSelect }),
    db.workOrder.count({ where: inProgressWhere }),
    db.workOrder.count({ where: todayWhere }),
    db.workOrder.count({ where: overdueWhere }),
  ]);
  return { inProgress, today, overdue, counts: { inProgress: nInProgress, today: nToday, overdue: nOverdue } };
}
export type ShopDay = Awaited<ReturnType<typeof shopToday>>;
export type ShopJob = ShopDay["inProgress"][number];

/** Open work orders (draft, open, in progress) and how many of them are past their booked day without starting. */
export async function workOrderCounts(now: Date) {
  const [open, overdue] = await Promise.all([
    db.workOrder.count({ where: { status: { in: OPEN_WORK } } }),
    db.workOrder.count({ where: { status: { in: NOT_STARTED }, scheduledAt: { lt: startOfDay(now) } } }),
  ]);
  return { open, overdue };
}

/** Open PM work orders for the given trucks, earliest booking first (the "Coming up" PM rows say "booked"). */
export async function openPmJobs(truckIds: string[]) {
  if (truckIds.length === 0) return new Map<string, { id: string; number: number; scheduledAt: Date }>();
  const rows = await db.workOrder.findMany({
    where: { truckId: { in: truckIds }, category: "PM", status: { in: OPEN_WORK } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, number: true, scheduledAt: true, truckId: true },
  });
  const byTruck = new Map<string, { id: string; number: number; scheduledAt: Date }>();
  for (const r of rows) if (r.truckId && !byTruck.has(r.truckId)) byTruck.set(r.truckId, r);
  return byTruck;
}

/* ------------------------------------------------------------------ */
/* Costs                                                               */
/* ------------------------------------------------------------------ */

export type CostMonth = { key: string; month: string; maintenance: number; fuel: number; total: number };

/**
 * Maintenance (completed work orders, by completion date) and fuel (fills, by date) for the last `months` calendar
 * months including this one, plus kilometres driven this month and last month from odometer readings.
 */
export async function costsByMonth(now: Date, months = 6) {
  const from = startOfMonth(subMonths(now, months - 1));
  const thisMonth = startOfMonth(now);
  const lastMonth = startOfMonth(subMonths(now, 1));
  const [work, fuel, kmNow, kmPrev] = await Promise.all([
    db.workOrder.findMany({ where: { status: "DONE", completedAt: { gte: from } }, select: { completedAt: true, cost: true, laborCost: true, partsCost: true } }),
    db.fuelLog.findMany({ where: { date: { gte: from } }, select: { date: true, cost: true } }),
    kmDriven(thisMonth, now),
    kmDriven(lastMonth, thisMonth),
  ]);
  const rows: CostMonth[] = Array.from({ length: months }, (_, i) => {
    const m = startOfMonth(subMonths(now, months - 1 - i));
    return { key: format(m, "yyyy-MM"), month: format(m, "MMM"), maintenance: 0, fuel: 0, total: 0 };
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const w of work) {
    const r = w.completedAt && byKey.get(format(w.completedAt, "yyyy-MM"));
    // `cost` is the job total; older jobs may only carry labour and parts.
    if (r) r.maintenance += w.cost || w.laborCost + w.partsCost;
  }
  for (const f of fuel) {
    const r = byKey.get(format(f.date, "yyyy-MM"));
    if (r) r.fuel += f.cost;
  }
  for (const r of rows) r.total = r.maintenance + r.fuel;
  return { months: rows, kmThisMonth: kmNow.total, kmLastMonth: kmPrev.total };
}

/* ------------------------------------------------------------------ */
/* Getting started                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a new company has set up so far. Members and invites are account tables (not company-scoped by `db`), so they
 * go through rootDb with the company id spelled out.
 */
export async function setupProgress(companyId: string) {
  const [trucks, trailers, drivers, companyDocs, members, invites] = await Promise.all([
    db.truck.count(),
    db.trailer.count(),
    db.driver.count(),
    db.document.count({ where: { isCompany: true } }),
    rootDb.membership.count({ where: { companyId, active: true } }),
    rootDb.invite.count({ where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { trucks, trailers, drivers, companyDocs, members, invites };
}
export type SetupProgress = Awaited<ReturnType<typeof setupProgress>>;
