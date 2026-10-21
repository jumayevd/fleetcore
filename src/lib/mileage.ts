import "server-only";
import { db } from "./db";

/*
 * Distance from odometer readings — fuel fills, repair orders that recorded the odometer (in and out), and each truck's
 * own odometer. Without loads this is the fleet's record of distance. Every distance is in the company's own unit
 * (miles or kilometres, see src/lib/locale.ts); nothing is converted here.
 */

const DAY = 86_400_000;

type Reading = { at: number; km: number };

/**
 * Every odometer reading before `to`, per truck. The truck's own odometer counts as a reading taken at `odometerAt`;
 * an odometer with no date (recorded before readings were dated) counts as "now", and only when `undatedAsNow` is set.
 */
async function readingsByTruck(to: Date, truckIds: string[] | undefined, undatedAsNow: boolean) {
  const inTrucks = truckIds ? { truckId: { in: truckIds } } : {};
  const [fuel, work, trucks] = await Promise.all([
    db.fuelLog.findMany({ where: { ...inTrucks, odometerKm: { not: null }, date: { lt: to } }, select: { truckId: true, odometerKm: true, date: true } }),
    db.workOrder.findMany({
      where: {
        ...(truckIds ? { truckId: { in: truckIds } } : { truckId: { not: null } }),
        voidedAt: null,
        OR: [{ odometerKm: { not: null } }, { odometerOutKm: { not: null } }],
        AND: [{ OR: [{ completedAt: { lt: to } }, { completedAt: null, inAt: { lt: to } }] }],
      },
      select: { truckId: true, odometerKm: true, odometerOutKm: true, completedAt: true, inAt: true, outAt: true, scheduledAt: true },
    }),
    db.truck.findMany({ where: truckIds ? { id: { in: truckIds } } : {}, select: { id: true, odometerKm: true, odometerAt: true } }),
  ]);
  const map = new Map<string, Reading[]>();
  const add = (truckId: string | null, at: Date | null, km: number | null) => {
    if (!truckId || !at || km == null || at.getTime() >= to.getTime()) return;
    const list = map.get(truckId) ?? [];
    list.push({ at: at.getTime(), km });
    map.set(truckId, list);
  };
  for (const f of fuel) add(f.truckId, f.date, f.odometerKm);
  for (const w of work) {
    if (w.odometerOutKm != null) {
      // Odometer in when the unit came in, odometer out when it left.
      add(w.truckId, w.inAt ?? w.scheduledAt, w.odometerKm);
      add(w.truckId, w.outAt ?? w.completedAt ?? new Date(), w.odometerOutKm);
    } else {
      add(w.truckId, w.completedAt ?? w.inAt ?? w.scheduledAt, w.odometerKm);
    }
  }
  const now = new Date();
  for (const t of trucks) {
    if (t.odometerAt) add(t.id, t.odometerAt, t.odometerKm);
    else if (undatedAsNow) add(t.id, new Date(Math.min(now.getTime(), to.getTime() - 1)), t.odometerKm);
  }
  return map;
}

/**
 * Distance driven per truck in [from, to): the highest reading in the window minus the last reading before it (or, when
 * there is none, the lowest reading in the window). Trucks with fewer than two readings count zero.
 */
export async function kmDriven(from: Date, to: Date = new Date(), truckIds?: string[]) {
  // An undated live odometer is a reading "now": it only counts when the window reaches the present.
  const reachesNow = to.getTime() >= Date.now() - 60_000;
  const end = reachesNow ? Date.now() + 1 : to.getTime();
  const readings = await readingsByTruck(new Date(end), truckIds, reachesNow);

  const byTruck = new Map<string, number>();
  for (const [truckId, list] of readings) {
    const before = list.filter((r) => r.at < from.getTime());
    const inside = list.filter((r) => r.at >= from.getTime() && r.at < end);
    if (!inside.length) continue;
    const top = Math.max(...inside.map((r) => r.km));
    const base = before.length ? Math.max(...before.map((r) => r.km)) : inside.length > 1 ? Math.min(...inside.map((r) => r.km)) : null;
    if (base == null) continue;
    byTruck.set(truckId, Math.max(0, top - base));
  }
  const total = [...byTruck.values()].reduce((a, b) => a + b, 0);
  return { total, byTruck };
}

/** Readings must span at least this many days before a daily rate is trusted. */
const MIN_SPAN_DAYS = 5;

/**
 * Average distance per day of each truck over its recent readings: the readings of the last `days` days plus the last
 * reading before them (when it is under a year old). Only dated readings count, so an odometer nobody dated never
 * passes for today's. A truck without two readings at least five days apart, or that did not move, is left out — say
 * "unknown" rather than guess. Used to turn "3,939 mi left" into "≈ 147 days".
 */
export async function distancePerDay(truckIds?: string[], days = 60, now: Date = new Date()): Promise<Map<string, number>> {
  const readings = await readingsByTruck(new Date(now.getTime() + 1), truckIds, false);
  const start = now.getTime() - days * DAY;
  const oldest = now.getTime() - 365 * DAY;
  const out = new Map<string, number>();
  for (const [truckId, list] of readings) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const inside = sorted.filter((r) => r.at >= start);
    const before = sorted.filter((r) => r.at < start && r.at >= oldest).pop();
    const base = before ?? inside[0];
    const top = inside[inside.length - 1];
    if (!base || !top || top === base) continue;
    const span = (top.at - base.at) / DAY;
    const distance = top.km - base.km;
    if (span < MIN_SPAN_DAYS || distance <= 0) continue;
    out.set(truckId, distance / span);
  }
  return out;
}

/** Days until a truck covers `left` at `perDay` (rounded up), or null when either is unknown or it is already due. */
export function daysToCover(left: number | null | undefined, perDay: number | null | undefined) {
  if (left == null || !perDay || perDay <= 0 || left <= 0) return null;
  return Math.ceil(left / perDay);
}
