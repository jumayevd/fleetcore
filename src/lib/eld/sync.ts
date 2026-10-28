import "server-only";
import { db } from "@/lib/db";
import { rootDb } from "@/lib/db-root";
import { withCompany } from "@/lib/tenant";
import { open } from "@/lib/secret-box";
import { fromZoned, normalizeLocale, type CompanyLocale } from "@/lib/locale";
import { EldError, emptyReason, fetchTrackProVehicles, type EldVehicle } from "./trackpro";

/*
 * Pull the company's trucks from its ELD and write what it knows onto the FleetCore trucks: position, place, heading,
 * fuel level, the time of the fix. TrackPro sends no speed or odometer, so:
 *  - speed is worked out from the last two fixes (distance / time), when they are close enough together to mean it;
 *  - EldUnit.gpsDistance adds up the straight-line distance between fixes since the truck's last odometer reading,
 *    a lower bound of what it has driven ("≈ +312 mi by GPS"). It never overwrites the odometer: an oil change is
 *    only as good as a real reading.
 * A sync runs at most once a minute per company (lastSyncAt is the lock): when someone uses the app (the layout and
 * the live map ask for one), from "Sync now", and from /api/cron/eld.
 */

export const PROVIDER = "TRACKPRO";
export const SYNC_EVERY_MS = 60_000;
const KM_PER_MI = 1.609344;
/** Faster than this between two fixes is a GPS jump, not driving (mph / km/h). */
const MAX_SPEED = { imperial: 90, metric: 145 };
/** Fixes further apart than this give no speed (the truck may have stopped and gone again in between). */
const SPEED_WINDOW_MS = 30 * 60_000;
/** …and are not added to the GPS distance either (a straight line over hours says little about the road). */
const DISTANCE_WINDOW_MS = 6 * 3600_000;
/** A truck whose last fix is older than this is taken as stopped. */
const STOPPED_AFTER_MS = 10 * 60_000;

export type SyncResult =
  | { status: "none" }
  | { status: "skipped" }
  | { status: "error"; message: string }
  | { status: "ok"; vehicles: number; matched: number; updated: number; note: string | null };

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "2026-02-06T12:13:44" read as UTC or as wall-clock time in the company's zone. A string with a zone wins. */
export function parseEldTime(raw: string | null, basis: string, tz: string): Date | null {
  if (!raw) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  if (basis === "COMPANY") return new Date(fromZoned(y, mo, d, h, mi, tz).getTime() + s * 1000);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

/**
 * Which reading of the provider's zone-less times is right: the one whose newest fix is closest to now without
 * being in the future (moving trucks report every few minutes). UTC when it can't tell.
 */
function detectBasis(times: (string | null)[], tz: string, now: Date): "UTC" | "COMPANY" {
  const score = (basis: string) => {
    const ts = times.map((t) => parseEldTime(t, basis, tz)?.getTime()).filter((t): t is number => t != null && t <= now.getTime() + 10 * 60_000);
    return ts.length ? now.getTime() - Math.max(...ts) : Infinity;
  };
  return score("COMPANY") < score("UTC") ? "COMPANY" : "UTC";
}

const unitKey = (u: string | null | undefined) => (u ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
const vinKey = (v: string | null | undefined) => {
  const k = (v ?? "").trim().toUpperCase();
  return k.length === 17 ? k : "";
};

function placeOf(v: EldVehicle, imperial: boolean) {
  const where = [v.city, v.state].filter(Boolean).join(", ");
  if (!where) return null;
  const away = v.nearbyDistance ?? 0;
  if (away < 1) return where;
  const n = imperial ? away : away * KM_PER_MI;
  return `${Math.round(n)} ${imperial ? "mi" : "km"} from ${where}`;
}

/** Sync one company (pinned, so it also works outside a request). Never throws: problems are saved on the connection. */
export async function syncCompanyEld(companyId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  return withCompany(companyId, async () => {
    const conn = await db.eldConnection.findFirst({ where: { provider: PROVIDER, active: true } });
    if (!conn) return { status: "none" } as const;
    const now = new Date();
    // The lock: only one sync per company per minute (or per 10 s for "Sync now").
    const gap = opts.force ? 10_000 : SYNC_EVERY_MS;
    const claimed = await db.eldConnection.updateMany({
      where: { id: conn.id, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(now.getTime() - gap) } }] },
      data: { lastSyncAt: now },
    });
    if (!claimed.count) return { status: "skipped" } as const;

    const fail = async (message: string) => {
      await db.eldConnection.update({ where: { id: conn.id }, data: { lastError: message } });
      return { status: "error", message } as const;
    };
    const token = open(conn.tokenEnc);
    if (!token) return fail("The saved token can't be read any more. Paste it again under Settings → Integrations.");

    let vehicles: EldVehicle[];
    let empty: string | null;
    try {
      const fetched = await fetchTrackProVehicles(token);
      vehicles = fetched.vehicles;
      empty = emptyReason(fetched);
    } catch (e) {
      return fail(e instanceof EldError ? e.message : "The sync failed. Try again in a minute.");
    }

    const company = await rootDb.company.findUnique({ where: { id: companyId }, select: { units: true, timezone: true, currency: true } });
    const locale: CompanyLocale = normalizeLocale(company);
    const imperial = locale.units === "imperial";
    let basis = conn.timeBasis;
    if (basis === "AUTO" && vehicles.some((v) => v.time)) {
      basis = detectBasis(vehicles.map((v) => v.time), locale.timezone, now);
      await db.eldConnection.update({ where: { id: conn.id }, data: { timeBasis: basis } });
    }

    const [trucks, known] = await Promise.all([
      db.truck.findMany({ select: { id: true, unitNumber: true, vin: true, odometerAt: true, lastPingAt: true, pingSource: true } }),
      db.eldUnit.findMany({ where: { connectionId: conn.id } }),
    ]);
    const byVin = new Map(trucks.filter((t) => vinKey(t.vin)).map((t) => [vinKey(t.vin), t]));
    const byUnit = new Map(trucks.map((t) => [unitKey(t.unitNumber), t]));
    const truckById = new Map(trucks.map((t) => [t.id, t]));
    const knownBy = new Map(known.map((u) => [u.externalId, u]));
    // A truck picked by hand for one ELD unit is never auto-matched to another.
    const taken = new Set(known.filter((u) => u.matchMode === "MANUAL" && u.truckId).map((u) => u.truckId!));

    let matched = 0;
    let updated = 0;
    for (const v of vehicles) {
      const prev = knownBy.get(v.externalId);
      let truckId: string | null;
      if (prev?.matchMode === "MANUAL") truckId = prev.truckId;
      else {
        const hit = byVin.get(vinKey(v.vin)) ?? byUnit.get(unitKey(v.unitNumber));
        truckId = hit && !taken.has(hit.id) ? hit.id : null;
      }
      if (truckId) { taken.add(truckId); matched++; }
      const truck = truckId ? truckById.get(truckId) ?? null : null;

      let fixAt = parseEldTime(v.time, basis === "AUTO" ? "UTC" : basis, locale.timezone);
      if (fixAt && fixAt.getTime() > now.getTime()) fixAt = now;
      const hasFix = v.lat != null && v.lng != null && fixAt != null;
      const newFix = hasFix && (!prev?.fixAt || fixAt!.getTime() > prev.fixAt.getTime());

      // Speed and distance from the previous fix.
      let speed = prev?.speed ?? null;
      let hop: number | null = null;
      const dtMs = newFix && prev?.fixAt ? fixAt!.getTime() - prev.fixAt.getTime() : null;
      if (newFix && prev?.lat != null && prev.lng != null && dtMs != null && dtMs > 0) {
        const km = distanceKm({ lat: prev.lat, lng: prev.lng }, { lat: v.lat!, lng: v.lng! });
        const d = imperial ? km / KM_PER_MI : km;
        const perHour = d / (dtMs / 3_600_000);
        const plausible = perHour <= MAX_SPEED[locale.units];
        speed = dtMs >= 30_000 && dtMs <= SPEED_WINDOW_MS && plausible ? Math.round(perHour) : dtMs > SPEED_WINDOW_MS ? null : speed;
        if (plausible && dtMs <= DISTANCE_WINDOW_MS) hop = d;
      } else if (newFix) speed = null;
      if (fixAt && now.getTime() - fixAt.getTime() > STOPPED_AFTER_MS) speed = 0;

      // GPS distance since the truck's last odometer reading.
      const base = truck?.odometerAt ?? null;
      let gpsDistance = prev?.gpsDistance ?? 0;
      let gpsFrom = prev?.gpsFrom ?? null;
      if ((gpsFrom?.getTime() ?? null) !== (base?.getTime() ?? null) || !truck) { gpsDistance = 0; gpsFrom = base; }
      if (truck && hop != null && prev?.fixAt && (!base || prev.fixAt.getTime() >= base.getTime())) gpsDistance += hop;

      const place = placeOf(v, imperial);
      const data = {
        unitNumber: v.unitNumber, vin: v.vin, make: v.make, model: v.model, driverName: v.driverName,
        truckId, lat: hasFix ? v.lat : prev?.lat ?? null, lng: hasFix ? v.lng : prev?.lng ?? null, fixAt: fixAt ?? prev?.fixAt ?? null,
        place: place ?? prev?.place ?? null, fuelPct: v.fuelPct, defPct: v.defPct, speed, gpsDistance: Math.round(gpsDistance * 10) / 10, gpsFrom, seenAt: now,
      };
      if (prev) await db.eldUnit.update({ where: { id: prev.id }, data });
      else await db.eldUnit.create({ data: { ...data, connectionId: conn.id, externalId: v.externalId } });

      // Onto the truck: a new fix (never older than what the truck already has from elsewhere).
      if (truck && hasFix && (newFix || truck.pingSource !== PROVIDER) && (!truck.lastPingAt || truck.pingSource === PROVIDER || fixAt!.getTime() >= truck.lastPingAt.getTime())) {
        await db.truck.update({
          where: { id: truck.id },
          data: {
            lat: v.lat, lng: v.lng, heading: v.heading, locationName: place, lastPingAt: fixAt, pingSource: PROVIDER, speedKmh: speed ?? 0,
            ...(v.fuelPct != null ? { fuelPct: Math.max(0, Math.min(100, v.fuelPct)) } : {}),
          },
        });
        updated++;
      } else if (truck && truck.pingSource === PROVIDER && speed === 0) {
        await db.truck.update({ where: { id: truck.id }, data: { speedKmh: 0 } });
      }
    }

    // TrackPro answered; an empty list still needs someone to act, so it shows as the connection's problem.
    await db.eldConnection.update({ where: { id: conn.id }, data: { lastSuccessAt: now, lastError: empty, vehicles: vehicles.length } });
    return { status: "ok", vehicles: vehicles.length, matched, updated, note: empty } as const;
  });
}

/** Every company with an active connection, one after the other (the cron route). */
export async function syncAllEld() {
  const conns = await rootDb.eldConnection.findMany({ where: { active: true }, select: { companyId: true } });
  const results: { companyId: string; result: SyncResult }[] = [];
  for (const c of conns) results.push({ companyId: c.companyId, result: await syncCompanyEld(c.companyId) });
  return results;
}

/** What the truck page and the oil board show from the ELD: GPS distance since the reading, ELD driver, fuel / DEF. */
export async function eldByTruck(truckIds?: string[]) {
  const units = await db.eldUnit.findMany({
    where: { truckId: truckIds ? { in: truckIds } : { not: null }, connection: { active: true } },
    select: { truckId: true, gpsDistance: true, gpsFrom: true, driverName: true, fuelPct: true, defPct: true, fixAt: true, place: true, speed: true },
  });
  return new Map(units.map((u) => [u.truckId!, u]));
}
