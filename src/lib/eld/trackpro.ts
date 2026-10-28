import "server-only";

/*
 * TrackPro ELD's API (https://trackproeld.com/docs) comes in two versions, and a carrier's token may answer on either:
 *   v2  GET https://api.trackproeld.com/logger/integrations/access/trucks?page=0&size=10
 *       { status, data: [{ unit: { unit_id, make, model, vin_number, unit_number }, driver_info: { driver_id,
 *         driver_name }, location: { unit_coordinates: { unit_latitude, unit_longitude }, distance, state, city,
 *         date_time, direction }, usdot, fuel_percentage, def_percentage }], metadata: { total, prev, next, current } }
 *   v1  GET https://api.trackproeld.com/logger/external/vehicles/current?page=0&size=10
 *       { result, content: [{ vehicle: { id, make, model, vin, unit_number }, driver: { id, name }, location: {
 *         vehicle_coordinates: { latitude, longitude }, distance, state, location, time, direction }, dot }],
 *         pageable: { total, prev, next, current } }
 * Both: Authorization: Bearer <token the carrier issues in TrackPro>; times have no zone; no speed, odometer or
 * engine data. v2 is asked first; v1 when v2 refuses the token or lists no trucks.
 * A live carrier token (2026-10) answers in a third layout, read here too: { truck: { id, make, model, vin,
 * unit_number }, driver: { id, name }, location: { vehicle_coordinates, nearby_location_coordinates, distance, state,
 * location, time, direction }, dot, fuel_level, def_level }.
 */

/** TRACKPRO_API_BASE points the client at a stand-in server for local testing; production uses TrackPro's own. */
const ROOT = process.env.TRACKPRO_API_BASE || "https://api.trackproeld.com/logger";
const APIS = { v2: "/integrations/access/trucks", v1: "/external/vehicles/current" } as const;
type Api = keyof typeof APIS;
const PAGE_SIZE = 50;
/** TrackPro's own default page size: asked for when a bigger page comes back empty. */
const DOC_PAGE_SIZE = 10;
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

/** What TrackPro answered, so an empty list can be explained on the Integrations page. */
export type EldFetch = {
  vehicles: EldVehicle[];
  api: Api;
  /** The total TrackPro reports for the token, when it says. */
  total: number | null;
  /** Items in the list, readable or not. */
  received: number;
  /** Field names of the first item FleetCore couldn't read (names only, never values). */
  unreadableFields: string[];
  /** Field names under location of the first truck FleetCore found no position in. */
  locationFields: string[];
};

const HEADINGS: Record<string, number> = { n: 0, nne: 22.5, ne: 45, ene: 67.5, e: 90, ese: 112.5, se: 135, sse: 157.5, s: 180, ssw: 202.5, sw: 225, wsw: 247.5, w: 270, wnw: 292.5, nw: 315, nnw: 337.5 };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const first = (...vs: unknown[]) => vs.find((v) => v != null && v !== "");

/** { latitude, longitude } under any of the names the layouts use, or [lat, lng], or "lat,lng". */
function latLng(v: unknown): [number | null, number | null] {
  if (Array.isArray(v)) {
    const [a, b] = [num(v[0]), num(v[1])];
    // GeoJSON order is [lng, lat]: a first value beyond ±90 can only be a longitude.
    return a != null && Math.abs(a) > 90 ? [b, a] : [a, b];
  }
  if (typeof v === "string" && v.includes(",")) return latLng(v.split(","));
  const c = obj(v);
  const named = (re: RegExp) => c[Object.keys(c).find((k) => re.test(k)) ?? ""];
  return [num(first(c.latitude, c.lat, named(/lat/i))), num(first(c.longitude, c.lng, c.lon, named(/lon|lng/i)))];
}

/** A fill level in percent: 63.5, "63.5", "63.5%", or a fraction (0.635); objects like { percentage } too. */
function pct(v: unknown): number | null {
  if (v && typeof v === "object") {
    const o = obj(v);
    return pct(first(o.percentage, o.percent, o.value, o.level));
  }
  const n = num(typeof v === "string" ? v.replace("%", "") : v);
  if (n == null || n < 0) return null;
  return n > 0 && n < 1 ? Math.round(n * 1000) / 10 : n;
}

/** One truck in any of the layouts. */
function toVehicle(raw: unknown): EldVehicle | null {
  const r = obj(raw);
  const unit = obj(r.unit ?? r.vehicle ?? r.truck);
  const driver = obj(r.driver_info ?? r.driver);
  const loc = obj(r.location);
  const unitNumber = str(first(unit.unit_number, unit.number));
  const vin = str(first(unit.vin_number, unit.vin))?.toUpperCase() ?? null;
  // The provider's id; failing that the VIN or unit number still tells trucks apart.
  const externalId = str(first(unit.unit_id, unit.id)) ?? (vin ? `vin:${vin}` : unitNumber ? `unit:${unitNumber}` : null);
  if (!externalId) return null;
  const coords = first(loc.unit_coordinates, loc.vehicle_coordinates, loc.truck_coordinates, loc.coordinates);
  const [lat, lng] = latLng(coords ?? loc);
  const valid = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  return {
    externalId,
    unitNumber,
    vin,
    make: str(unit.make),
    model: str(unit.model),
    driverName: str(first(driver.driver_name, driver.name)),
    lat: valid ? lat : null,
    lng: valid ? lng : null,
    time: str(first(loc.date_time, loc.time)),
    heading: HEADINGS[str(loc.direction)?.toLowerCase() ?? ""] ?? null,
    city: str(first(loc.city, typeof loc.location === "string" ? loc.location : null)),
    state: str(loc.state),
    nearbyDistance: num(loc.distance),
    fuelPct: pct(first(r.fuel_percentage, r.fuel_level, r.fuel)),
    defPct: pct(first(r.def_percentage, r.def_level, r.def)),
  };
}

/** "unit.unit_id, location.city, …": the shape of an item, for the page to show when it can't be read. */
function fieldNames(raw: unknown, prefix = "", depth = 0): string[] {
  const r = obj(raw);
  return Object.keys(r).flatMap((k) => {
    const sub = r[k];
    return sub && typeof sub === "object" && !Array.isArray(sub) && depth < 2 ? fieldNames(sub, `${prefix}${k}.`, depth + 1) : [`${prefix}${k}`];
  }).slice(0, 32);
}

async function page(api: Api, token: string, n: number, size: number) {
  let res: Response;
  try {
    res = await fetch(`${ROOT}${APIS[api]}?page=${n}&size=${size}`, {
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
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body.content) ? body.content : null;
  if (!list) {
    const keys = Object.keys(body).slice(0, 8).join(", ");
    throw new EldError(`TrackPro sent something that isn't the truck list${keys ? ` (it has: ${keys})` : ""}.`, "format");
  }
  const meta = obj(body.metadata ?? body.pageable);
  const vehicles = list.map(toVehicle).filter((v): v is EldVehicle => v != null);
  const bad = list.find((item) => toVehicle(item) == null);
  const noFix = list.find((item) => { const v = toVehicle(item); return v != null && v.lat == null; });
  return {
    vehicles, received: list.length, total: num(meta.total), next: num(meta.next),
    unreadableFields: bad === undefined ? [] : fieldNames(bad),
    locationFields: noFix === undefined ? [] : fieldNames(obj(noFix).location, "location."),
  };
}

/** Every truck one version of the API shows for the token, page by page. */
async function listAll(api: Api, token: string): Promise<EldFetch> {
  let size = PAGE_SIZE;
  let p = await page(api, token, 0, size);
  // An empty first page: ask again exactly the way TrackPro's docs do, in case the bigger page isn't allowed.
  if (p.received === 0) { size = DOC_PAGE_SIZE; p = await page(api, token, 0, size); }
  const out: EldFetch = { vehicles: [...p.vehicles], api, total: p.total, received: p.received, unreadableFields: p.unreadableFields, locationFields: p.locationFields };
  let n = 0;
  for (let i = 1; i < MAX_PAGES && p.next != null && p.next > n && p.received > 0; i++) {
    n = p.next;
    p = await page(api, token, n, size);
    out.vehicles.push(...p.vehicles);
    out.received += p.received;
    if (!out.unreadableFields.length) out.unreadableFields = p.unreadableFields;
    if (!out.locationFields.length) out.locationFields = p.locationFields;
  }
  // The same truck on two pages (the list moved while paging) counts once.
  out.vehicles = [...new Map(out.vehicles.map((v) => [v.externalId, v])).values()];
  return out;
}

/** Every truck the token can see: version 2 of the API, else version 1. Throws EldError when neither answers. */
export async function fetchTrackProVehicles(token: string): Promise<EldFetch> {
  let v2: EldFetch | null = null;
  let v2Error: EldError | null = null;
  try {
    v2 = await listAll("v2", token);
    if (v2.received > 0) return v2;
  } catch (e) {
    if (!(e instanceof EldError) || e.kind === "network") throw e;
    v2Error = e;
  }
  try {
    const v1 = await listAll("v1", token);
    if (v1.received > 0 || !v2) return v1;
  } catch (e) {
    if (!v2) throw v2Error ?? e;
  }
  return v2!;
}

/**
 * What is wrong with a sync that worked, in words for the Integrations page: no trucks, or trucks without a single
 * position. Null when trucks came in with positions (a few parked without GPS are normal).
 */
export function emptyReason(r: EldFetch): string | null {
  if (r.vehicles.length > 0 && r.vehicles.some((v) => v.lat != null)) return null;
  if (r.vehicles.length > 0) {
    return `TrackPro sent ${r.vehicles.length} ${r.vehicles.length === 1 ? "truck" : "trucks"}, but FleetCore found no position in any of them (location fields: ${r.locationFields.join(", ") || "none"}). The trucks are listed below without positions.`;
  }
  if (r.received > 0) {
    return `TrackPro sent ${r.received} ${r.received === 1 ? "truck" : "trucks"}, but in a layout FleetCore doesn't read yet (fields: ${r.unreadableFields.join(", ") || "none"}). Nothing was imported.`;
  }
  if (r.total != null && r.total > 0) return `TrackPro says this token has ${r.total} trucks but sent an empty list. Try Sync now; if it stays empty, tell TrackPro support.`;
  return "TrackPro accepted the token but shows no trucks for it. Ask TrackPro support to give this token access to your company's trucks, or check it was issued for the right carrier.";
}
