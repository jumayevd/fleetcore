import { TIMEZONE, nearestCity } from "@/lib/constants";

/**
 * Where a unit was last seen, and how much that position still says. Nothing simulates movement any more: positions
 * come from the record (manual updates, seed data) or a telematics device, so the assistant reports the last known
 * place and its age instead of pretending to track the unit live.
 */

const HOUR = 3_600_000;
/** Past this age a position is "last known", and speed / engine state no longer describe the unit right now. */
const FRESH_MS = HOUR;
/** Above this speed a truck is moving. */
const MOVING_KMH = 5;

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

const at = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function lastSeen(p: PositionInput, now = Date.now()) {
  const location = p.locationName ?? (p.lat != null && p.lng != null ? nearestCity(p.lat, p.lng).label : null);
  if (!location && !p.lastPingAt) return { location: null, note: "no position recorded" };
  const ageMs = p.lastPingAt ? Math.max(0, now - p.lastPingAt.getTime()) : null;
  const fresh = ageMs != null && ageMs < FRESH_MS;
  const source = p.pingSource ?? p.gpsProvider ?? null;
  return {
    location,
    asOf: p.lastPingAt ? at.format(p.lastPingAt) : null,
    hoursAgo: ageMs == null ? null : Math.round((ageMs / HOUR) * 10) / 10,
    source: source ? (SOURCE_LABELS[source] ?? source) : "unknown",
    fresh,
    // Speed and engine state only describe the unit while the position is fresh.
    ...(fresh && p.speedKmh != null ? { speedKmh: Math.round(p.speedKmh), moving: p.speedKmh > MOVING_KMH } : {}),
    ...(fresh && p.engineOn != null ? { engineOn: p.engineOn } : {}),
    ...(p.fuelPct != null ? { fuelPct: Math.round(p.fuelPct) } : {}),
  };
}
