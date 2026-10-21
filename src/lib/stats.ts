import "server-only";
import { addDays, format, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { db } from "./db";

const COMPLETED = ["DELIVERED", "INVOICED"];

export async function monthlyFinancials(months = 6) {
  const from = startOfMonth(subMonths(new Date(), months - 1));
  const loads = await db.load.findMany({
    where: { status: { in: COMPLETED }, deliveredAt: { gte: from } },
    select: { deliveredAt: true, rate: true, driverPay: true, fuelCost: true, otherCost: true, distanceKm: true, emptyKm: true, deliveryAt: true },
  });
  const buckets = new Map<string, { month: string; revenue: number; cost: number; loads: number; km: number; emptyKm: number; onTime: number }>();
  for (let i = 0; i < months; i++) {
    const m = format(subMonths(new Date(), months - 1 - i), "MMM yy");
    buckets.set(m, { month: m, revenue: 0, cost: 0, loads: 0, km: 0, emptyKm: 0, onTime: 0 });
  }
  for (const l of loads) {
    const b = buckets.get(format(l.deliveredAt!, "MMM yy"));
    if (!b) continue;
    b.revenue += l.rate;
    b.cost += l.driverPay + l.fuelCost + l.otherCost;
    b.loads += 1;
    b.km += l.distanceKm;
    b.emptyKm += l.emptyKm;
    if (l.deliveredAt! <= l.deliveryAt) b.onTime += 1;
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    revenue: Math.round(b.revenue),
    cost: Math.round(b.cost),
    margin: Math.round(b.revenue - b.cost),
    onTimePct: b.loads ? Math.round((b.onTime / b.loads) * 100) : 0,
    revPerKm: b.km ? Math.round((b.revenue / b.km) * 100) / 100 : 0,
    emptyPct: b.km + b.emptyKm ? Math.round((b.emptyKm / (b.km + b.emptyKm)) * 100) : 0,
  }));
}

export async function receivables() {
  const open = await db.invoice.findMany({ where: { status: "SENT" } });
  const now = Date.now();
  const aging = { current: 0, "1-30": 0, "31-60": 0, "60+": 0 };
  for (const i of open) {
    const late = Math.floor((now - i.dueAt.getTime()) / 86_400_000);
    const amt = i.amount * (1 + i.taxRate);
    if (late <= 0) aging.current += amt;
    else if (late <= 30) aging["1-30"] += amt;
    else if (late <= 60) aging["31-60"] += amt;
    else aging["60+"] += amt;
  }
  const total = Object.values(aging).reduce((a, b) => a + b, 0);
  const overdue = total - aging.current;
  return { aging, total, overdue, count: open.length };
}

/** Month-to-date revenue vs. the same number of days into last month (fair early-month comparison). */
export async function revenueMtdComparison() {
  const now = new Date();
  const thisStart = startOfMonth(now);
  const lastStart = startOfMonth(subMonths(now, 1));
  const lastSameDay = new Date(lastStart.getTime() + (now.getTime() - thisStart.getTime()));
  const sum = (gte: Date, lt: Date) =>
    db.load.aggregate({ where: { status: { in: COMPLETED }, deliveredAt: { gte, lt } }, _sum: { rate: true } }).then((r) => r._sum.rate ?? 0);
  const [mtd, prior] = await Promise.all([sum(thisStart, now), sum(lastStart, lastSameDay)]);
  return { mtd, prior };
}

/* ------------------------------------------------------------------ */
/* Weekly production board                                             */
/* ------------------------------------------------------------------ */

export const WEEKLY_GOAL_KEYS = { solo: "weekly.goalSolo", team: "weekly.goalTeam" } as const;
const DEFAULT_GOALS = { solo: 5000, team: 7500 };

export async function weeklyGoals() {
  const rows = await db.appSetting.findMany({ where: { key: { in: Object.values(WEEKLY_GOAL_KEYS) } } });
  const v = (k: string, d: number) => Number(rows.find((r) => r.key === k)?.value ?? d) || d;
  return { solo: v(WEEKLY_GOAL_KEYS.solo, DEFAULT_GOALS.solo), team: v(WEEKLY_GOAL_KEYS.team, DEFAULT_GOALS.team) };
}

export type WeeklyCell = { amount: number; km: number; loads: { id: string; reference: string; status: string }[] };
export type WeeklyDriverRow = {
  driver: { id: string; name: string; type: string; truck: string | null; hold: boolean };
  days: WeeklyCell[]; total: number; km: number; rpk: number; goal: number; planDelta: number; daysWorked: number; efficiency: number;
};
export type WeeklyTeamRow = { team: { id: string | null; name: string; color: string | null }; rows: WeeklyDriverRow[]; total: number; km: number; avgPerTruck: number; efficiency: number };

/** Revenue per driver per day for the week starting `weekStart` (Monday). Loads count on their pickup day. */
export async function weeklyProduction(weekStart: Date) {
  const start = startOfWeek(weekStart, { weekStartsOn: 1 });
  const end = addDays(start, 7);
  const goals = await weeklyGoals();
  const [drivers, loads, teams] = await Promise.all([
    db.driver.findMany({ where: { status: { not: "INACTIVE" } }, include: { truck: { select: { unitNumber: true } } }, orderBy: { name: "asc" } }),
    db.load.findMany({
      where: { pickupAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED"] }, driverId: { not: null } },
      select: { id: true, reference: true, status: true, driverId: true, pickupAt: true, rate: true, distanceKm: true },
    }),
    db.team.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const byDriver = new Map<string, WeeklyCell[]>();
  const blank = () => Array.from({ length: 7 }, () => ({ amount: 0, km: 0, loads: [] as WeeklyCell["loads"] }));
  for (const l of loads) {
    const day = Math.min(6, Math.max(0, Math.floor((l.pickupAt.getTime() - start.getTime()) / 86_400_000)));
    if (!byDriver.has(l.driverId!)) byDriver.set(l.driverId!, blank());
    const cell = byDriver.get(l.driverId!)![day];
    cell.amount += l.rate; cell.km += l.distanceKm; cell.loads.push({ id: l.id, reference: l.reference, status: l.status });
  }
  const rowFor = (d: (typeof drivers)[number]): WeeklyDriverRow => {
    const days = byDriver.get(d.id) ?? blank();
    const total = days.reduce((a, c) => a + c.amount, 0);
    const km = days.reduce((a, c) => a + c.km, 0);
    const goal = d.type === "COMPANY" ? goals.solo : goals.team;
    return {
      driver: { id: d.id, name: d.name, type: d.type, truck: d.truck?.unitNumber ?? null, hold: d.hold },
      days, total, km, rpk: km ? Math.round((total / km) * 100) / 100 : 0, goal, planDelta: total - goal,
      daysWorked: days.filter((c) => c.loads.length).length, efficiency: goal ? Math.round((total / goal) * 100) : 0,
    };
  };
  const groups: WeeklyTeamRow[] = [...teams.map((t) => ({ id: t.id as string | null, name: t.name, color: t.color })), { id: null, name: "No team", color: null }]
    .map((team) => {
      const rows = drivers.filter((d) => (d.teamId ?? null) === team.id).map(rowFor).sort((a, b) => b.total - a.total);
      const total = rows.reduce((a, r) => a + r.total, 0);
      const km = rows.reduce((a, r) => a + r.km, 0);
      const goal = rows.reduce((a, r) => a + r.goal, 0);
      return { team, rows, total, km, avgPerTruck: rows.length ? Math.round(total / rows.length) : 0, efficiency: goal ? Math.round((total / goal) * 100) : 0 };
    })
    .filter((g) => g.rows.length);
  const grand = { total: groups.reduce((a, g) => a + g.total, 0), km: groups.reduce((a, g) => a + g.km, 0), drivers: groups.reduce((a, g) => a + g.rows.length, 0) };
  return { start, end, goals, groups, grand: { ...grand, avgPerTruck: grand.drivers ? Math.round(grand.total / grand.drivers) : 0, rpk: grand.km ? Math.round((grand.total / grand.km) * 100) / 100 : 0 } };
}

/* ------------------------------------------------------------------ */
/* Maintenance analytics                                               */
/* ------------------------------------------------------------------ */

export async function maintenanceSummary(from: Date, to: Date) {
  const [done, open, kmRun] = await Promise.all([
    db.workOrder.findMany({ where: { status: "DONE", completedAt: { gte: from, lt: to } }, include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { unitNumber: true } } } }),
    db.workOrder.findMany({ where: { status: "IN_PROGRESS" }, include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { unitNumber: true } } } }),
    db.load.aggregate({ where: { status: { in: COMPLETED }, deliveredAt: { gte: from, lt: to } }, _sum: { distanceKm: true, emptyKm: true } }),
  ]);
  const spend = done.reduce((a, w) => a + w.cost, 0);
  const km = (kmRun._sum.distanceKm ?? 0) + (kmRun._sum.emptyKm ?? 0);
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
    byVendor: group((w) => w.vendor ?? "No vendor recorded").slice(0, 8),
    byCategory: group((w) => w.category),
    perUnit, median,
    flagged: perUnit.filter((u) => u.cost > median * 1.8 && u.cost > 500),
  };
}
