import "server-only";
import { db } from "./db";
import { pmState } from "@/components/map/fleet-status";

/**
 * Last known position and state of every truck in service, for the live map, the overview and /api/fleet.
 *
 * Nothing is simulated: positions, speed, fuel and engine state are what was last written to the truck (by a manual
 * update, or by a tracker / telematics integration when one posts). The live map decides from `lastPingAt` and
 * `pingSource` whether that is live, parked or silent (src/components/map/fleet-status.ts).
 *
 * Dates are ISO strings so the same shape goes over JSON to the polling map.
 */
export async function fleetSnapshot() {
  const trucks = await db.truck.findMany({
    where: { status: { not: "INACTIVE" } },
    orderBy: { unitNumber: "asc" },
    select: {
      id: true, unitNumber: true, make: true, model: true, year: true, plate: true, status: true, group: true,
      odometerKm: true, pmIntervalKm: true, lastPmKm: true, nextServiceKm: true,
      lat: true, lng: true, speedKmh: true, heading: true, fuelPct: true, engineOn: true, locationName: true, lastPingAt: true, pingSource: true,
      driver: { select: { id: true, name: true, phone: true, hold: true, holdReason: true } },
      trailers: { select: { id: true, unitNumber: true }, orderBy: { unitNumber: "asc" } },
      workOrders: { where: { status: "IN_PROGRESS" }, select: { id: true, number: true, title: true }, orderBy: { scheduledAt: "asc" }, take: 1 },
    },
  });

  return trucks.map((t) => {
    const pm = pmState(t);
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
      lat: t.lat,
      lng: t.lng,
      speedKmh: t.speedKmh ?? 0,
      heading: t.heading ?? 0,
      fuelPct: t.fuelPct,
      engineOn: t.engineOn ?? false,
      locationName: t.locationName,
      lastPingAt: t.lastPingAt?.toISOString() ?? null,
      pingSource: t.pingSource,
      driver: t.driver,
      /** Trailers currently paired with this tractor. */
      trailers: t.trailers,
      /** Next service by odometer: `leftKm` < 0 is overdue, "due" is inside PM_DUE_SOON_KM. */
      pm,
      /** The work order the truck is in the shop for right now (status IN_PROGRESS), if any. */
      workInProgress: t.workOrders[0] ?? null,
    };
  });
}

export type FleetSnapshot = Awaited<ReturnType<typeof fleetSnapshot>>;
export type FleetTruck = FleetSnapshot[number];
