import { nearestCity } from "@/lib/constants";
import type { Kit } from "./kit";

/**
 * Where a unit was last seen, and how much that position still says. Nothing simulates movement any more: positions
 * come from the record (manual updates, seed data) or a telematics device, so the assistant reports the last known
 * place and its age instead of pretending to track the unit live. Speeds are in the company's unit (speedKmh holds mph
 * for an imperial company), times in its time zone.
 */

const HOUR = 3_600_000;
/** Past this age a position is "last known", and speed / engine state no longer describe the unit right now. */
const FRESH_MS = HOUR;
/** Above this speed a truck is moving. */
const MOVING = 5;

/** Prisma select for the truck fields lastSeen() reads. */
export const TRUCK_POSITION_FIELDS = {
  lat: true, lng: true, locationName: true, lastPingAt: true, pingSource: true, speedKmh: true, engineOn: true, fuelPct: true,
} as const;
/** Prisma select for the trailer fields lastSeen() reads. */
export const TRAILER_POSITION_FIELDS = { lat: true, lng: true, locationName: true, lastPingAt: true, gpsProvider: true } as const;

export type PositionInput = {
  lat: number | null; lng: number | null; locationName: string | null; lastPingAt: Date | null;
  pingSource?: string | null; gpsProvider?: string | null; speedKmh?: number | null; engineOn?: boolean | null; fuelPct?: number | null;
};

const SOURCE_LABELS: Record<string, string> = { MANUAL: "manual update", DEVICE: "GPS device", SIMULATED: "old estimate" };

export function lastSeen(p: PositionInput, kit: Kit, now = Date.now()) {
  const location = p.locationName ?? (p.lat != null && p.lng != null ? nearestCity(p.lat, p.lng, kit.f.units).label : null);
  if (!location && !p.lastPingAt) return { location: null, note: "no position recorded" };
  const ageMs = p.lastPingAt ? Math.max(0, now - p.lastPingAt.getTime()) : null;
  const fresh = ageMs != null && ageMs < FRESH_MS;
  const source = p.pingSource ?? p.gpsProvider ?? null;
  return {
    location,
    asOf: kit.dateTime(p.lastPingAt),
    hoursAgo: ageMs == null ? null : Math.round((ageMs / HOUR) * 10) / 10,
    source: source ? (SOURCE_LABELS[source] ?? source) : "unknown",
    fresh,
    // Speed and engine state only describe the unit while the position is fresh.
    ...(fresh && p.speedKmh != null ? { speed: kit.f.speed(p.speedKmh), moving: p.speedKmh > MOVING } : {}),
    ...(fresh && p.engineOn != null ? { engineOn: p.engineOn } : {}),
    ...(p.fuelPct != null ? { fuelPct: Math.round(p.fuelPct) } : {}),
  };
}
