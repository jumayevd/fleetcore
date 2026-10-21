import "server-only";
import { db } from "./db";

/**
 * Distance driven, from odometer readings: fuel fills and work orders that recorded the odometer, plus the truck's
 * current odometer for windows that run up to now. Without loads this is the fleet's record of kilometres.
 *
 * For each truck in [from, to): the highest reading in the window minus the last reading before it (or, when there is
 * none, the lowest reading in the window). Trucks with fewer than two readings count zero.
 */
export async function kmDriven(from: Date, to: Date = new Date(), truckIds?: string[]) {
  const unit = truckIds ? { truckId: { in: truckIds } } : { truckId: { not: null } };
  const [fuel, work, trucks] = await Promise.all([
    db.fuelLog.findMany({ where: { ...(truckIds ? { truckId: { in: truckIds } } : {}), odometerKm: { not: null }, date: { lt: to } }, select: { truckId: true, odometerKm: true, date: true } }),
    db.workOrder.findMany({
      where: { ...unit, odometerKm: { not: null }, OR: [{ completedAt: { lt: to } }, { completedAt: null, inAt: { lt: to } }] },
      select: { truckId: true, odometerKm: true, completedAt: true, inAt: true, scheduledAt: true },
    }),
    db.truck.findMany({ where: truckIds ? { id: { in: truckIds } } : {}, select: { id: true, odometerKm: true } }),
  ]);
  const readings = new Map<string, { at: number; km: number }[]>();
  const add = (truckId: string | null, at: Date, km: number | null) => {
    if (!truckId || km == null) return;
    const list = readings.get(truckId) ?? [];
    list.push({ at: at.getTime(), km });
    readings.set(truckId, list);
  };
  for (const f of fuel) add(f.truckId, f.date, f.odometerKm);
  for (const w of work) add(w.truckId, w.completedAt ?? w.inAt ?? w.scheduledAt, w.odometerKm);
  // The live odometer is a reading "now": it only counts when the window reaches the present.
  const reachesNow = to.getTime() >= Date.now() - 60_000;
  const now = new Date();
  if (reachesNow) for (const t of trucks) add(t.id, now, t.odometerKm);
  const end = reachesNow ? now.getTime() + 1 : to.getTime();

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
