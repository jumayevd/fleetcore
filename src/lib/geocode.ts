import "server-only";
import { db } from "./db";
import { placeFromText } from "@/app/(app)/fleet/lib";

/*
 * Where a vendor is, for "Vendors near this truck". A street address goes to the US Census geocoder (free, no key,
 * US addresses), then OpenStreetMap's Nominatim; without an address, or when neither finds it, the vendor's city from
 * the built-in city list. Each vendor is looked up once (Vendor.geocodedAt) and again only when its address changes.
 * Only the vendor's address or city leaves FleetCore, nothing about trucks or people.
 */

export type GeoPrecision = "ADDRESS" | "CITY" | "NONE";
type Geo = { lat: number; lng: number; precision: Exclude<GeoPrecision, "NONE"> };

const UA = "FleetCore/1.0 (+https://fleetcore-uz.vercel.app)";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
  return res.ok ? res.json() : null;
}

async function census(q: string): Promise<Geo | null> {
  const j = (await getJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(q)}`)) as
    { result?: { addressMatches?: { coordinates?: { x?: number; y?: number } }[] } } | null;
  const c = j?.result?.addressMatches?.[0]?.coordinates;
  return c && typeof c.x === "number" && typeof c.y === "number" ? { lat: c.y, lng: c.x, precision: "ADDRESS" } : null;
}

/** Nominatim's policy is one request a second at most: only ever called one vendor at a time. */
async function nominatim(q: string): Promise<Geo | null> {
  const j = (await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`)) as { lat?: string; lon?: string }[] | null;
  const h = Array.isArray(j) ? j[0] : null;
  const lat = Number(h?.lat), lng = Number(h?.lon);
  return h && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, precision: "ADDRESS" } : null;
}

/**
 * Coordinates for an address and / or city; null when nothing is found. Never throws. `nominatim: false` keeps to the
 * Census geocoder and the city list (safe to run for several vendors at once).
 */
export async function geocodeAddress(address: string | null, city: string | null, opts: { nominatim?: boolean } = {}): Promise<Geo | null> {
  const useOsm = opts.nominatim !== false;
  try {
    if (address) {
      const full = [address, city].filter(Boolean).join(", ");
      const hit = (await census(full)) ?? (useOsm ? await nominatim(full) : null);
      if (hit) return hit;
    }
    const place = placeFromText(city ?? address ?? "");
    if (place.lat != null && place.lng != null) return { lat: place.lat, lng: place.lng, precision: "CITY" };
    if (city && useOsm) {
      const hit = await nominatim(city);
      if (hit) return { ...hit, precision: "CITY" };
    }
  } catch { /* offline or slow: nothing found this time */ }
  return null;
}

const save = (id: string, geo: Geo | null) => db.vendor.update({
  where: { id },
  data: { lat: geo?.lat ?? null, lng: geo?.lng ?? null, geoPrecision: geo?.precision ?? "NONE", geocodedAt: new Date() },
});

/** Look one vendor up and store the result (NONE when nothing was found, so it is not asked again until it changes). */
export async function geocodeVendor(v: { id: string; address: string | null; city: string | null }) {
  const geo = v.address || v.city ? await geocodeAddress(v.address, v.city) : null;
  await save(v.id, geo);
  return geo;
}

/**
 * Vendors that have an address or a city but were never looked up, a few at a time so the first "Vendors near" fills
 * them in without a long wait: Census and the city list for all of them at once, then OpenStreetMap one by one (a
 * second apart, its policy) for up to three it missed. The rest wait for the next time.
 */
export async function geocodeMissingVendors(limit = 8) {
  const pending = await db.vendor.findMany({
    where: { geocodedAt: null, OR: [{ address: { not: null } }, { city: { not: null } }] },
    select: { id: true, address: true, city: true }, take: limit,
  });
  const first = await Promise.all(pending.map((v) => geocodeAddress(v.address, v.city, { nominatim: false })));
  let asked = 0;
  for (const [i, v] of pending.entries()) {
    if (first[i]) { await save(v.id, first[i]); continue; }
    if (asked >= 3) continue;
    if (asked) await new Promise((r) => setTimeout(r, 1100));
    asked++;
    await save(v.id, await geocodeAddress(v.address, v.city));
  }
  return pending.length;
}
