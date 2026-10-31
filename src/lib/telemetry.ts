import "server-only";
import { db } from "./db";
import { getFormat } from "./format-server";
import { defectLabel, serviceStatus } from "./service";
import { PTI_COMPONENT_LABELS, humanize, nearestCity } from "./constants";
import type { ServiceSnapshot } from "@/components/map/fleet-status";

/**
 * Last known position and state of every truck in service, for the live map, the Today page and /api/fleet.
 *
 * Nothing is simulated: positions, speed, fuel and engine state are what was last written to the truck (by a manual
 * update, or by a tracker / telematics integration when one posts). The live map decides from `lastPingAt` and
 * `pingSource` whether that is live, parked or silent (src/components/map/fleet-status.ts).
 *
 * Distances and speeds are in the company's own unit (miles and mph for an imperial company). Dates are ISO strings so
 * the same shape goes over JSON to the polling map.
 */
export async function fleetSnapshot() {
  const now = new Date();
  const [f, trucks, holds] = await Promise.all([
    getFormat(),
    db.truck.findMany({
      where: { status: { not: "INACTIVE" } },
      orderBy: { unitNumber: "asc" },
      select: {
        id: true, unitNumber: true, make: true, model: true, year: true, plate: true, status: true, group: true,
        odometerKm: true, odometerAt: true, pmIntervalKm: true, lastPmKm: true, lastPmAt: true, nextServiceKm: true,
        truckType: { select: { name: true, oilIntervalKm: true } },
        lat: true, lng: true, speedKmh: true, heading: true, fuelPct: true, engineOn: true, locationName: true, lastPingAt: true, pingSource: true,
        driver: { select: { id: true, name: true, phone: true, hold: true, holdReason: true } },
        trailers: { select: { id: true, unitNumber: true }, orderBy: { unitNumber: "asc" } },
        workOrders: { where: { status: "IN_PROGRESS", voidedAt: null }, select: { id: true, number: true, title: true }, orderBy: { scheduledAt: "asc" }, take: 1 },
      },
    }),
    // Defects that keep a truck out of service until someone verifies the repair.
    db.defect.findMany({
      where: { holdsUnit: true, status: { in: ["OPEN", "REPAIRED"] }, truckId: { not: null } },
      orderBy: { foundAt: "asc" },
      select: { id: true, number: true, truckId: true, component: true, description: true, status: true },
    }),
  ]);

  const holdsByTruck = new Map<string, typeof holds>();
  for (const d of holds) holdsByTruck.set(d.truckId!, [...(holdsByTruck.get(d.truckId!) ?? []), d]);

  return trucks.map((t) => {
    const s = serviceStatus(t, now);
    const service: ServiceSnapshot = { state: s.state, left: s.left, dueAtKm: s.dueAtKm, stale: s.stale, readingAt: s.readingAt?.toISOString() ?? null };
    const defects = holdsByTruck.get(t.id) ?? [];
    const first = defects[0];
    const hold = first
      ? {
          /** The first holding defect, for the link. */
          defectId: first.id,
          count: defects.length,
          /** "DEF-0004 Brakes — air leak at rear axle" */
          label: `${defectLabel(first.number)} ${PTI_COMPONENT_LABELS[first.component] ?? humanize(first.component)} — ${first.description}`,
          /** Every holding defect is repaired and only waits for someone to confirm it. */
          repaired: defects.every((d) => d.status === "REPAIRED"),
        }
      : null;
    const hasPosition = t.lat != null && t.lng != null;
    return {
      id: t.id,
      unitNumber: t.unitNumber,
      name: `${t.make} ${t.model}`,
      year: t.year,
      plate: t.plate,
      /** ACTIVE | MAINTENANCE | OUT_OF_SERVICE (INACTIVE trucks are left out). */
      status: t.status,
      group: t.group,
      odometerKm: t.odometerKm,
      odometerAt: t.odometerAt?.toISOString() ?? null,
      lat: t.lat,
      lng: t.lng,
      /** In the company's unit (mph or km/h). */
      speedKmh: t.speedKmh ?? 0,
      heading: t.heading ?? 0,
      fuelPct: t.fuelPct,
      engineOn: t.engineOn ?? false,
      locationName: t.locationName,
      /** Where it is in words: the recorded place, else "12 mi from Joliet, IL". */
      place: t.locationName ?? (hasPosition ? nearestCity(t.lat!, t.lng!, f.units).label : null),
      lastPingAt: t.lastPingAt?.toISOString() ?? null,
      pingSource: t.pingSource,
      driver: t.driver,
      /** Trailers currently paired with this tractor. */
      trailers: t.trailers,
      /** Oil / PM by odometer (serviceStatus). */
      service,
      /** Defects holding the truck out of service, if any. */
      hold,
      /** Held by a defect, or marked out of service: it must not be dispatched. */
      outOfService: t.status === "OUT_OF_SERVICE" || hold != null,
      /** The repair the truck is in the shop for right now (status IN_PROGRESS), if any. */
      workInProgress: t.workOrders[0] ?? null,
    };
  });
}

export type FleetSnapshot = Awaited<ReturnType<typeof fleetSnapshot>>;
export type FleetTruck = FleetSnapshot[number];
