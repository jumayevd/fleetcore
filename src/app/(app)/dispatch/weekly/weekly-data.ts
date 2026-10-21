import "server-only";
import { db } from "@/lib/db";
import { weeklyGoals, type WeeklyCell, type WeeklyDriverRow, type WeeklyTeamRow } from "@/lib/stats";
import { dayStart, isWeekendYmd, isYmd, mondayOf, shiftYmd, todayYmd, ymdDayMonth, ymdWeekday } from "../dates";

/** One weekday column of the weekly board, labelled on the server so both render passes agree. */
export type WeekDay = { ymd: string; weekday: string; label: string; weekend: boolean };

/** `week` query param → Monday (YYYY-MM-DD) of that week. Anything that isn't a real calendar date means this week. */
export function parseWeek(v: unknown) {
  return mondayOf(isYmd(v) ? v : todayYmd());
}

/** Monday of the current week in the company timezone. */
export const thisWeekMonday = () => mondayOf(todayYmd());

/**
 * Revenue per driver per day for the week starting `monday`, in the company timezone. Same rules and result shape as
 * `weeklyProduction()` in lib/stats (loads count on their pickup day, goals per driver type), but the week and its day
 * buckets are calendar days in TIMEZONE instead of the server's zone (UTC on Vercel). Once stats accepts a
 * timezone-aware start, the board and the export can switch back to it.
 */
export async function weeklyProductionTz(monday: string) {
  const ymds = Array.from({ length: 7 }, (_, i) => shiftYmd(monday, i));
  const starts = ymds.map((d) => dayStart(d).getTime());
  const start = new Date(starts[0]);
  const end = dayStart(shiftYmd(monday, 7));
  const goals = await weeklyGoals();
  const [drivers, loads, teams] = await Promise.all([
    db.driver.findMany({
      where: { status: { not: "INACTIVE" } },
      select: { id: true, name: true, type: true, hold: true, teamId: true, truck: { select: { unitNumber: true } } },
      orderBy: { name: "asc" },
    }),
    db.load.findMany({
      where: { pickupAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED"] }, driverId: { not: null } },
      select: { id: true, reference: true, status: true, driverId: true, pickupAt: true, rate: true, distanceKm: true },
    }),
    db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
  ]);

  const blank = () => Array.from({ length: 7 }, () => ({ amount: 0, km: 0, loads: [] as WeeklyCell["loads"] }));
  const byDriver = new Map<string, WeeklyCell[]>();
  for (const l of loads) {
    const t = l.pickupAt.getTime();
    let day = 6;
    while (day > 0 && t < starts[day]) day--;
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
  const days: WeekDay[] = ymds.map((ymd) => ({ ymd, weekday: ymdWeekday(ymd), label: ymdDayMonth(ymd), weekend: isWeekendYmd(ymd) }));

  return {
    monday, start, end, days, goals, groups,
    grand: { ...grand, avgPerTruck: grand.drivers ? Math.round(grand.total / grand.drivers) : 0, rpk: grand.km ? Math.round((grand.total / grand.km) * 100) / 100 : 0 },
  };
}
