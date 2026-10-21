import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { bearing, pathPolyline, pointAlongPolyline } from "./geo";
import { nearestCity } from "./constants";

/**
 * Telemetry: until real GPS devices / ELDs are integrated, trucks on an
 * in-transit load are simulated moving along their route (through every stop)
 * based on elapsed time. A real device ping (driver app, /api/telemetry/ping,
 * or a telematics provider) always wins over simulation for DEVICE_FRESH_MS.
 */
const AVG_SPEED_KMH = 58; // incl. stops, border crossings, rest breaks
const DEVICE_FRESH_MS = 5 * 60_000;
const SYNC_THROTTLE_MS = 10_000;
let lastSync = 0;

type RoutedLoad = { departedAt: Date | null; distanceKm: number; stops?: { lat: number; lng: number; seq: number }[]; originLat: number; originLng: number; destLat: number; destLng: number };

export function loadProgress(load: Pick<RoutedLoad, "departedAt" | "distanceKm">, now = Date.now()) {
  if (!load.departedAt) return 0;
  const durationMs = (load.distanceKm / AVG_SPEED_KMH) * 3_600_000;
  return Math.min(1, Math.max(0, (now - load.departedAt.getTime()) / durationMs));
}

export function estimatedArrival(load: Pick<RoutedLoad, "departedAt" | "distanceKm">) {
  if (!load.departedAt) return null;
  return new Date(load.departedAt.getTime() + (load.distanceKm / AVG_SPEED_KMH) * 3_600_000);
}

/** Route polyline through all stops (falls back to origin → destination). */
export function loadRoute(load: RoutedLoad): [number, number][] {
  const pts = load.stops && load.stops.length >= 2
    ? [...load.stops].sort((a, b) => a.seq - b.seq).map((s) => ({ lat: s.lat, lng: s.lng }))
    : [{ lat: load.originLat, lng: load.originLng }, { lat: load.destLat, lng: load.destLng }];
  return pathPolyline(pts);
}

let labeled = false;

/**
 * Moves every simulated truck (and its trailer) to where its load should be now. One read and at most two
 * batched UPDATEs, so the pages that call it (overview, live map, board, fleet, load detail) pay a couple of
 * round trips instead of one per truck. Throttled per server instance.
 */
export async function syncSimulatedPositions(force = false) {
  const now = Date.now();
  if (!force && now - lastSync < SYNC_THROTTLE_MS) return;
  lastSync = now;

  const loads = await db.load.findMany({
    where: { status: "IN_TRANSIT", truckId: { not: null } },
    select: {
      departedAt: true, distanceKm: true, originLat: true, originLng: true, destLat: true, destLng: true, trailerId: true,
      truck: { select: { id: true, unitNumber: true, heading: true, pingSource: true, lastPingAt: true } },
      stops: { select: { lat: true, lng: true, seq: true, status: true, city: true } },
    },
  });

  const trucks: Prisma.Sql[] = [];
  const trailers: Prisma.Sql[] = [];
  for (const l of loads) {
    const t = l.truck!;
    // A real device ping wins over simulation while it is fresh.
    if (t.pingSource && t.pingSource !== "SIMULATED" && t.lastPingAt && now - t.lastPingAt.getTime() < DEVICE_FRESH_MS) continue;
    // On site (arrived at a stop, not yet loaded / unloaded): parked at that stop, whatever the clock says.
    const current = [...l.stops].sort((a, b) => a.seq - b.seq).find((s) => s.status !== "DONE");
    let lat: number, lng: number, heading: number | null, speed: number, engine: boolean, fuel: number | null, label: string;
    if (current?.status === "ARRIVED") {
      ({ lat, lng } = current);
      heading = t.heading; speed = 0; engine = false; fuel = null; label = nearestCity(lat, lng).label;
    } else {
      const route = loadRoute(l);
      const p = loadProgress(l, now);
      const pos = pointAlongPolyline(route, p);
      // Deterministic-ish speed wobble so the fleet doesn't look robotic.
      const wobble = Math.sin(now / 60_000 + t.unitNumber.charCodeAt(t.unitNumber.length - 1)) * 12;
      ({ lat, lng } = pos);
      heading = p < 1 ? bearing(pos, pointAlongPolyline(route, Math.min(1, p + 0.01))) : t.heading;
      speed = p < 1 ? Math.round(72 + wobble) : 0;
      engine = p < 1;
      fuel = Math.max(6, Math.round(92 - p * (l.distanceKm / 9)));
      label = nearestCity(lat, lng).label;
    }
    trucks.push(Prisma.sql`(${t.id}::text, ${lat}::float8, ${lng}::float8, ${heading}::float8, ${speed}::float8, ${engine}::boolean, ${fuel}::float8, ${label}::text)`);
    // A paired trailer travels with the tractor.
    if (l.trailerId) trailers.push(Prisma.sql`(${l.trailerId}::text, ${lat}::float8, ${lng}::float8, ${current?.status === "ARRIVED" ? current.city : label}::text)`);
  }

  // Timestamps are written by the database in UTC, the way Prisma stores DateTime (timestamp without time zone).
  await Promise.all([
    trucks.length && db.$executeRaw`
      UPDATE "Truck" AS t SET "lat" = v.lat, "lng" = v.lng, "heading" = v.heading, "speedKmh" = v.speed, "engineOn" = v.engine,
        "fuelPct" = COALESCE(v.fuel, t."fuelPct"), "locationName" = v.label, "lastPingAt" = timezone('UTC', now()), "pingSource" = 'SIMULATED'
      FROM (VALUES ${Prisma.join(trucks)}) AS v(id, lat, lng, heading, speed, engine, fuel, label)
      WHERE t."id" = v.id`,
    trailers.length && db.$executeRaw`
      UPDATE "Trailer" AS r SET "lat" = v.lat, "lng" = v.lng, "locationName" = v.label, "lastPingAt" = timezone('UTC', now())
      FROM (VALUES ${Prisma.join(trailers)}) AS v(id, lat, lng, label)
      WHERE r."id" = v.id`,
  ]);

  // Idle trucks: fill in a location label once per server instance so lists never show blanks.
  if (!labeled || force) {
    labeled = true;
    const unlabeled = await db.truck.findMany({ where: { locationName: null, lat: { not: null } }, select: { id: true, lat: true, lng: true } });
    await Promise.all(unlabeled.map((t) => db.truck.update({ where: { id: t.id }, data: { locationName: nearestCity(t.lat!, t.lng!).label, speedKmh: 0, engineOn: false } })));
  }
}

export async function fleetSnapshot() {
  await syncSimulatedPositions();
  const trucks = await db.truck.findMany({
    where: { status: { not: "INACTIVE" } },
    orderBy: { unitNumber: "asc" },
    include: {
      driver: { select: { id: true, name: true, phone: true, boardStatus: true, hold: true, team: { select: { name: true } } } },
      loads: {
        where: { status: { in: ["IN_TRANSIT", "ASSIGNED"] } },
        orderBy: { pickupAt: "asc" },
        take: 2,
        include: { customer: { select: { name: true } }, stops: { orderBy: { seq: "asc" } } },
      },
    },
  });

  return trucks.map((t) => {
    // The load on the road wins over an earlier-booked one that hasn't started.
    const l = t.loads.find((x) => x.status === "IN_TRANSIT") ?? t.loads[0];
    const progress = l && l.status === "IN_TRANSIT" ? loadProgress(l) : 0;
    const nextStop = l?.stops.find((s) => s.status !== "DONE");
    return {
      id: t.id,
      unitNumber: t.unitNumber,
      name: `${t.make} ${t.model}`,
      plate: t.plate,
      status: t.status,
      lat: t.lat,
      lng: t.lng,
      speedKmh: t.speedKmh ?? 0,
      heading: t.heading ?? 0,
      fuelPct: t.fuelPct,
      engineOn: t.engineOn ?? false,
      locationName: t.locationName,
      lastPingAt: t.lastPingAt?.toISOString() ?? null,
      pingSource: t.pingSource,
      driver: t.driver ? { id: t.driver.id, name: t.driver.name, phone: t.driver.phone, boardStatus: t.driver.boardStatus, hold: t.driver.hold, team: t.driver.team?.name ?? null } : null,
      load: l
        ? {
            id: l.id,
            reference: l.reference,
            status: l.status,
            customer: l.customer.name,
            originCity: l.originCity,
            destCity: l.destCity,
            nextStop: nextStop ? { type: nextStop.type, status: nextStop.status, name: nextStop.name, city: nextStop.city, windowEnd: (nextStop.windowEnd ?? nextStop.windowStart)?.toISOString() ?? null } : null,
            stops: l.stops.map((s) => ({ lat: s.lat, lng: s.lng, type: s.type, status: s.status, name: s.name })),
            progress,
            eta: estimatedArrival(l)?.toISOString() ?? null,
            deliveryAt: l.deliveryAt.toISOString(),
            route: loadRoute(l),
          }
        : null,
    };
  });
}

export type FleetSnapshot = Awaited<ReturnType<typeof fleetSnapshot>>;
