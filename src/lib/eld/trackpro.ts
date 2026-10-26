import "server-only";

/*
 * TrackPro ELD integration API, version 2 (https://trackproeld.com/docs):
 *   GET https://api.trackproeld.com/logger/integrations/access/trucks?page=0&size=10
 *   Authorization: Bearer <token the carrier issues in TrackPro>
 * Each truck: unit (unit_id, make, model, vin_number, unit_number), driver_info (driver_id, driver_name), location
 * (unit_coordinates, nearby_coordinates, distance from the nearby place, state, city, date_time without a zone,
 * direction like "sw"), usdot, fuel_percentage, def_percentage. There is no speed, odometer or engine data.
 */

/** TRACKPRO_API_BASE points the client at a stand-in server for local testing; production uses TrackPro's own. */
const BASE = process.env.TRACKPRO_API_BASE || "https://api.trackproeld.com/logger/integrations/access";
const PAGE_SIZE = 50;
const MAX_PAGES = 40;
const TIMEOUT_MS = 12_000;

export class EldError extends Error {
  constructor(message: string, readonly kind: "auth" | "forbidden" | "network" | "format") {
    super(message);
  }
}

export type EldVehicle = {
  externalId: string;
  unitNumber: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  driverName: string | null;
  lat: number | null;
  lng: number | null;
  /** The provider's timestamp as written ("2026-02-06T12:13:44", no zone): sync.ts decides what zone it is in. */
  time: string | null;
  /** Compass heading in degrees, from "n", "ne", … */
  heading: number | null;
  city: string | null;
  state: string | null;
  /** Miles from the nearby place. */
  nearbyDistance: number | null;
  fuelPct: number | null;
  defPct: number | null;
};

const HEADINGS: Record<string, number> = { n: 0, nne: 22.5, ne: 45, ene: 67.5, e: 90, ese: 112.5, se: 135, sse: 157.5, s: 180, ssw: 202.5, sw: 225, wsw: 247.5, w: 270, wnw: 292.5, nw: 315, nnw: 337.5 };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function toVehicle(raw: unknown): EldVehicle | null {
  const r = obj(raw);
  const unit = obj(r.unit);
  const driver = obj(r.driver_info);
  const loc = obj(r.location);
  const coords = obj(loc.unit_coordinates);
  const externalId = str(unit.unit_id);
  if (!externalId) return null;
  const lat = num(coords.unit_latitude);
  const lng = num(coords.unit_longitude);
  const valid = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  return {
    externalId,
    unitNumber: str(unit.unit_number),
    vin: str(unit.vin_number)?.toUpperCase() ?? null,
    make: str(unit.make),
    model: str(unit.model),
    driverName: str(driver.driver_name),
    lat: valid ? lat : null,
    lng: valid ? lng : null,
    time: str(loc.date_time),
    heading: HEADINGS[str(loc.direction)?.toLowerCase() ?? ""] ?? null,
    city: str(loc.city),
    state: str(loc.state),
    nearbyDistance: num(loc.distance),
    fuelPct: num(r.fuel_percentage),
    defPct: num(r.def_percentage),
  };
}

async function page(token: string, n: number) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/trucks?page=${n}&size=${PAGE_SIZE}`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new EldError("TrackPro didn't answer. Try again in a minute.", "network");
  }
  if (res.status === 401) throw new EldError("TrackPro refused the token. Check it, or ask TrackPro for a new one.", "auth");
  if (res.status === 403) throw new EldError("TrackPro says this token may not read the trucks. Ask TrackPro to allow it.", "forbidden");
  if (!res.ok) throw new EldError(`TrackPro answered with an error (${res.status}). Try again later.`, "network");
  let body: Record<string, unknown>;
  try {
    body = obj(await res.json());
  } catch {
    throw new EldError("TrackPro sent something that isn't the truck list.", "format");
  }
  const data = Array.isArray(body.data) ? body.data : null;
  if (!data) throw new EldError("TrackPro sent something that isn't the truck list.", "format");
  const next = num(obj(body.metadata).next);
  return { vehicles: data.map(toVehicle).filter((v): v is EldVehicle => v != null), next };
}

/** Every truck the token can see, page by page. */
export async function fetchTrackProVehicles(token: string): Promise<EldVehicle[]> {
  const all: EldVehicle[] = [];
  let n = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const p = await page(token, n);
    all.push(...p.vehicles);
    if (p.next == null || p.next <= n || p.vehicles.length === 0) break;
    n = p.next;
  }
  return all;
}
