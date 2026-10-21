import "server-only";
import { nearestCity } from "@/lib/constants";
import { pointAlongPolyline } from "@/lib/geo";
import { loadProgress, loadRoute } from "@/lib/telemetry";

/** Same freshness rule as lib/telemetry.ts (not exported there): a real device ping wins for 5 minutes. */
const DEVICE_FRESH_MS = 5 * 60_000;

export type MotionTruck = {
  unitNumber: string; speedKmh: number | null; engineOn: boolean | null; fuelPct: number | null;
  locationName: string | null; lastPingAt: Date | null; pingSource: string | null;
};
/** The truck's in-transit load with what the route simulation needs. */
export type MotionLoad = {
  departedAt: Date | null; distanceKm: number; originLat: number; originLng: number; destLat: number; destLng: number;
  stops: { lat: number; lng: number; seq: number; status: string; city: string }[];
};
export type Motion = {
  speedKmh: number; engineOn: boolean; fuelPct: number | null; location: string | null;
  /** device ping = fresh telematics; route estimate = simulated along the in-transit load's route; last ping = stored position. */
  source: "device ping" | "route estimate" | "last ping";
  at: Date | null;
};

/**
 * Where a truck is and how fast it is going right now, without writing anything. Read-only twin of
 * syncSimulatedPositions() in lib/telemetry.ts: a truck on an in-transit load gets the same route
 * simulation the live map stores (parked while arrived at a stop); a fresh device ping wins; every
 * other truck reports its last stored ping.
 */
export function currentMotion(t: MotionTruck, transit: MotionLoad | null | undefined, now = Date.now()): Motion {
  const stored = { speedKmh: t.speedKmh ?? 0, engineOn: t.engineOn ?? false, fuelPct: t.fuelPct, location: t.locationName, at: t.lastPingAt };
  const fresh = t.pingSource != null && t.pingSource !== "SIMULATED" && t.lastPingAt != null && now - t.lastPingAt.getTime() < DEVICE_FRESH_MS;
  if (fresh) return { ...stored, source: "device ping" };
  if (!transit) return { ...stored, source: "last ping" };

  const at = new Date(now);
  const current = [...transit.stops].sort((a, b) => a.seq - b.seq).find((s) => s.status !== "DONE");
  if (current?.status === "ARRIVED") {
    return { speedKmh: 0, engineOn: false, fuelPct: t.fuelPct, location: nearestCity(current.lat, current.lng).label, source: "route estimate", at };
  }
  const p = loadProgress(transit, now);
  const pos = pointAlongPolyline(loadRoute(transit), p);
  // Same speed wobble as the simulation, so the assistant and the map agree.
  const wobble = Math.sin(now / 60_000 + t.unitNumber.charCodeAt(t.unitNumber.length - 1)) * 12;
  return {
    speedKmh: p < 1 ? Math.round(72 + wobble) : 0,
    engineOn: p < 1,
    fuelPct: Math.max(6, Math.round(92 - p * (transit.distanceKm / 9))),
    location: nearestCity(pos.lat, pos.lng).label,
    source: "route estimate",
    at,
  };
}
