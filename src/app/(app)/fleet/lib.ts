import type { Tone } from "@/components/ui";
import { CITIES, humanize } from "@/lib/constants";
import { daysUntil } from "@/lib/format";
import type { Formatter } from "@/lib/locale";
import { SERVICE_STATE_TONE, type ServiceStatus } from "@/lib/service";

/* Pure helpers shared by the truck and trailer pages, their forms and the fleet actions (client-safe). */

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const TRUCK_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Available", MAINTENANCE: "In shop", VENDOR: "Vendor", OUT_OF_SERVICE: "Out of service", INACTIVE: "Inactive",
};

/** What a new truck can start as. Later changes go through the status menu (setTruckStatus). */
export const NEW_TRUCK_STATUSES = ["ACTIVE", "VENDOR"] as const;

/** A truck in service reads Assigned when it has a driver and Available when it has none. */
export const truckStatusLabel = (status: string, hasDriver: boolean) =>
  status === "ACTIVE" && hasDriver ? "Assigned" : TRUCK_STATUS_LABELS[status] ?? status;
/** The badge colour key for the same (STATUS_TONE). */
export const truckStatusTone = (status: string, hasDriver: boolean) => (status === "ACTIVE" && hasDriver ? "ASSIGNED" : status);

export const OWNERSHIP_TONE: Record<string, Tone> = { COMPANY: "neutral", OWNER_OPERATOR: "progress", LEASED: "info" };
export const OWNERSHIP_SHORT: Record<string, string> = { COMPANY: "Company", OWNER_OPERATOR: "Owner-op", LEASED: "Leased" };

export const FUEL_TYPES = [
  { value: "DIESEL", label: "Diesel" }, { value: "LNG", label: "LNG" }, { value: "CNG", label: "CNG" }, { value: "ELECTRIC", label: "Electric" },
];
export const FUEL_TYPE_LABELS: Record<string, string> = Object.fromEntries(FUEL_TYPES.map((f) => [f.value, f.label]));

/** Telematics vendors offered in the trailer form's datalist (free text is still allowed). */
export const GPS_PROVIDERS = ["Samsara", "Motive", "Geotab", "Omnitracs", "SkyBitz", "Teltonika"];

/**
 * Trailer statuses that physically leave the tractor, so setting one clears the pairing. In use and Empty stay hooked:
 * an empty trailer usually stays on its truck until someone drops it.
 */
export const UNHOOKED_TRAILER_STATUSES: readonly string[] = ["DROPPED", "YARD", "SHOP", "OUT_OF_SERVICE", "INACTIVE"];

/** Odometer readings this far above the last one need a second look before they are saved (an extra digit). */
export const ODOMETER_JUMP_KM = 50_000;

/** The truck and trailer tables stop at this many rows (the counters still count every unit). */
export const LIST_LIMIT = 500;

/** Repair orders still open on a unit (scheduled or in the shop). */
export const OPEN_REPAIR_STATUSES = ["DRAFT", "OPEN", "IN_PROGRESS"];

/* ------------------------------------------------------------------ */
/* Truck list views                                                    */
/* ------------------------------------------------------------------ */

export const TRUCK_VIEWS = ["fleet", "off", "archived"] as const;
export type TruckView = (typeof TRUCK_VIEWS)[number];
export const TRUCK_VIEW_LABELS: Record<TruckView, string> = { fleet: "The fleet", off: "Off the road", archived: "Archived" };
/** Which statuses each view lists. */
export const TRUCK_VIEW_STATUSES: Record<TruckView, readonly string[]> = {
  fleet: ["ACTIVE", "MAINTENANCE", "VENDOR", "OUT_OF_SERVICE"],
  off: ["MAINTENANCE", "OUT_OF_SERVICE"],
  archived: ["INACTIVE"],
};

/* ------------------------------------------------------------------ */
/* Oil / PM service (the rule itself is serviceStatus in src/lib/service.ts) */
/* ------------------------------------------------------------------ */

export type ServiceSummary = { tone: Tone; text: string; detail: string | null };

/**
 * One line for a truck's next oil service, in the company's units: "3,939 mi · ≈ 147 days", "1,204 mi over",
 * "No recent reading" (with "≥ 8,092 mi used as of Sep 24"). `days` is the estimate from recent driving; null hides it.
 */
export function serviceSummary(s: ServiceStatus, f: Formatter, days: number | null): ServiceSummary {
  const tone = SERVICE_STATE_TONE[s.state];
  const asOf = s.readingAt ? ` as of ${f.day(s.readingAt)}` : "";
  switch (s.state) {
    case "unknown":
      return { tone, text: "No oil change recorded", detail: "Log the last oil change to start the countdown" };
    case "overdue":
      return { tone, text: `${f.dist(-(s.left ?? 0))} over`, detail: s.stale ? `at least that far${asOf}` : `due at ${f.dist(s.dueAtKm)}` };
    case "no_reading":
      return {
        tone, text: "No recent reading",
        detail: s.used != null ? `≥ ${f.dist(s.used)} used${asOf}` : `${f.dist(s.left)} left${asOf}`,
      };
    default:
      return { tone, text: `${f.dist(s.left)}${days != null ? ` · ≈ ${f.number(days)} days` : ""}`, detail: `due at ${f.dist(s.dueAtKm)}` };
  }
}

/** "10,000 mi · Day cab type" / "30,000 mi · this truck's own interval". */
export function intervalText(s: Pick<ServiceStatus, "interval" | "intervalFrom">, f: Formatter) {
  return `${f.dist(s.interval)} · ${s.intervalFrom ? `${s.intervalFrom} type` : "this truck's own interval"}`;
}

/* ------------------------------------------------------------------ */
/* Defects                                                             */
/* ------------------------------------------------------------------ */

type DefectLike = { status: string; severity: string; dueAt: Date | null; holdsUnit: boolean };

/** A defect that needs a decision today: it keeps the unit off the road, is rated "fix before next load", or is past due. */
export function isUrgentDefect(d: DefectLike, now: Date = new Date()) {
  if (d.status === "CLOSED") return false;
  if (d.holdsUnit) return true;
  return d.status === "OPEN" && (d.severity === "NOW" || (d.dueAt != null && d.dueAt < now));
}

/* ------------------------------------------------------------------ */
/* Lease mileage control                                               */
/* ------------------------------------------------------------------ */

export type LeaseInput = {
  ownership: string; odometerKm: number; lessor: string | null;
  leaseStartKm: number | null; leaseAnnualLimitKm: number | null; leaseBufferPct: number | null; leaseOverageRate: number | null;
};
export type LeaseState = "ok" | "near" | "buffer" | "over";

/**
 * allowed = start + annual limit; hard cap = allowed + buffer. Over the hard cap costs `rate` per distance unit.
 * Mirrors the alert rule in src/lib/alerts.ts so the truck page and the alert agree.
 */
export function leaseStatus(t: LeaseInput) {
  if (t.ownership !== "LEASED" || !t.leaseAnnualLimitKm) return null;
  const startKm = t.leaseStartKm ?? 0;
  const limitKm = t.leaseAnnualLimitKm;
  const bufferPct = t.leaseBufferPct ?? 0;
  const allowedKm = startKm + limitKm;
  const hardCapKm = startKm + Math.round(limitKm * (1 + bufferPct / 100));
  const usedKm = Math.max(0, t.odometerKm - startKm);
  const remainingKm = hardCapKm - t.odometerKm; // negative = over the hard cap
  const overKm = Math.max(0, -remainingKm);
  const rate = t.leaseOverageRate ?? 0;
  const exposure = overKm * rate;
  const state: LeaseState = overKm > 0 ? "over" : t.odometerKm > allowedKm ? "buffer" : remainingKm < 5000 ? "near" : "ok";
  const tone: Tone = state === "over" ? "danger" : state === "ok" ? "ok" : "warn";
  const span = Math.max(1, hardCapKm - startKm);
  return {
    lessor: t.lessor, startKm, limitKm, bufferPct, allowedKm, hardCapKm, usedKm, remainingKm, overKm, rate, exposure, state, tone,
    pct: Math.min(1, usedKm / span),
    allowedMarker: Math.min(1, limitKm / span),
  };
}

/* ------------------------------------------------------------------ */
/* Telemetry helpers                                                   */
/* ------------------------------------------------------------------ */

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function compass(deg: number | null | undefined) {
  if (deg == null) return "—";
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const PING_SOURCE_LABELS: Record<string, string> = { MANUAL: "Manual update", DEVICE: "GPS device", SAMSARA: "Samsara", TRACKPRO: "TrackPro ELD" };

/** Where the last position came from. Positions recorded before this workspace existed show as "Recorded position". */
export function pingSourceLabel(src: string | null | undefined) {
  if (!src) return "No source";
  return PING_SOURCE_LABELS[src] ?? (src === "SIMULATED" ? "Recorded position" : humanize(src));
}

/**
 * A place typed by hand → what to store. When it names a known city ("Joliet, IL", "Joliet yard") the unit gets that
 * city's coordinates, so it shows on the map; anything else is kept as text with no position.
 */
export function placeFromText(text: string): { locationName: string; lat: number | null; lng: number | null } {
  const name = text.trim().replace(/\s+/g, " ");
  const lower = name.toLowerCase();
  // "Joliet, IL" also answers to "Joliet".
  const bare = (c: string) => c.toLowerCase().replace(/,\s*[a-z]{2}$/, "");
  const escape = (s: string) => s.replace(/[.*+?^$|()[\]\\{}]/g, "\\$&");
  const mentions = (c: string) => new RegExp("(^|[^a-z])" + escape(bare(c)) + "([^a-z]|$)").test(lower);
  const city = CITIES.find((c) => c.name.toLowerCase() === lower || bare(c.name) === lower)
    ?? CITIES.find((c) => lower.includes(c.name.toLowerCase()))
    ?? CITIES.find((c) => mentions(c.name));
  if (!city) return { locationName: name, lat: null, lng: null };
  return { locationName: city.name.toLowerCase() === lower || bare(city.name) === lower ? city.name : name, lat: city.lat, lng: city.lng };
}

export function pingStale(d: Date | string | null | undefined, hours = 1) {
  if (!d) return true;
  return Date.now() - new Date(d).getTime() > hours * 3_600_000;
}

export function fuelTone(pct: number | null | undefined): Tone {
  if (pct == null) return "neutral";
  if (pct < 15) return "danger";
  if (pct < 30) return "warn";
  return "ok";
}

/** Compact duration since a timestamp: 12m · 5h · 3d · 2mo. */
export function sinceShort(d: Date | string | null | undefined) {
  if (!d) return "—";
  const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 60) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

/** Whole days since a timestamp (status timers, time in shop, reading age). */
export function daysSince(d: Date | string) {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
}

/* ------------------------------------------------------------------ */
/* Paperwork                                                           */
/* ------------------------------------------------------------------ */

/**
 * Earliest of the given dates, ignoring missing ones. Paperwork expiry is the earlier of the date on the unit record and
 * the expiry on the newest uploaded document of that kind, so a stale record date can't hide an expired certificate.
 */
export function earliest(...dates: (Date | null | undefined)[]): Date | null {
  let min: Date | null = null;
  for (const d of dates) if (d && (!min || d < min)) min = d;
  return min;
}

/** Paperwork counts as expiring this many days ahead (same window as ExpiryBadge and the compliance alerts). */
export const EXPIRY_SOON_DAYS = 30;

/** unitId → document kind → expiry on the newest uploaded document of that kind. Pass the rows newest first. */
export function docExpiryByUnit(rows: { id: string | null; kind: string; expiresAt: Date | null }[]) {
  const m = new Map<string, Map<string, Date | null>>();
  for (const r of rows) {
    if (!r.id) continue;
    let kinds = m.get(r.id);
    if (!kinds) m.set(r.id, (kinds = new Map()));
    if (!kinds.has(r.kind)) kinds.set(r.kind, r.expiresAt);
  }
  return m;
}

export type PaperworkKind = "REGISTRATION" | "INSURANCE" | "INSPECTION";

/** Effective expiry of each required paper: the earlier of the unit record's date and the newest document's expiry. */
export function paperworkExpiry(
  unit: { insuranceExpiry: Date | null; inspectionExpiry: Date | null; registrationExpiry?: Date | null },
  docs: Map<string, Date | null> | undefined,
): Record<PaperworkKind, Date | null> {
  return {
    REGISTRATION: earliest(unit.registrationExpiry, docs?.get("REGISTRATION")),
    INSURANCE: earliest(unit.insuranceExpiry, docs?.get("INSURANCE")),
    INSPECTION: earliest(unit.inspectionExpiry, docs?.get("INSPECTION")),
  };
}

/** Record dates of a unit per document kind (what the panel shows when a slot has no file, or no date on the file). */
export function recordedExpiry(unit: { insuranceExpiry: Date | null; inspectionExpiry: Date | null; registrationExpiry?: Date | null }) {
  return { REGISTRATION: unit.registrationExpiry ?? null, INSURANCE: unit.insuranceExpiry, INSPECTION: unit.inspectionExpiry };
}

/** How many of the dates have passed, and how many fall within the next EXPIRY_SOON_DAYS days. */
export function expiryCounts(dates: (Date | null)[]) {
  let expired = 0;
  let soon = 0;
  for (const d of dates) {
    const days = daysUntil(d);
    if (days == null) continue;
    if (days < 0) expired++;
    else if (days <= EXPIRY_SOON_DAYS) soon++;
  }
  return { expired, soon };
}

/** unitId → set of document kinds on file. */
export function docsByUnit(rows: { id: string | null; kind: string }[]) {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.id) continue;
    if (!m.has(r.id)) m.set(r.id, new Set());
    m.get(r.id)!.add(r.kind);
  }
  return m;
}

export function missingDocs(have: Set<string> | undefined, required: readonly string[]) {
  return required.filter((k) => !have?.has(k));
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export type TruckNote = { date: string | null; author: string | null; text: string };

/** Notes are stored newest-first as "YYYY-MM-DD Name: text" lines (see addTruckNote; the day is company time). */
export function parseNotes(notes: string | null | undefined): TruckNote[] {
  if (!notes) return [];
  return notes.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}) ([^:]+): (.*)$/);
    return m ? { date: m[1], author: m[2], text: m[3] } : { date: null, author: null, text: line };
  });
}

/** A "YYYY-MM-DD" day as an instant that falls on that day in every time zone within ±12 h (for display only). */
export const dayAsDate = (key: string) => new Date(`${key}T12:00:00.000Z`);
