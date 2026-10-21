import type { Tone } from "@/components/ui";
import type { Formatter } from "@/lib/locale";
import { SERVICE_STATE_TONE, type ServiceState } from "@/lib/service";

/**
 * Live-fleet rules shared by the live map (client), the Today page and the alerts (server). A plain module: no
 * "use client", no server-only, so both sides compute "rolling", "out of service" and "no signal" the same way.
 * Speeds and distances are in the company's own unit (see src/lib/locale.ts): nothing here converts.
 */

/** Above this (mph or km/h, the company's unit) a truck is rolling; at or below it is idle or stopped. */
export const ROLLING_KMH = 5;
/** A tracker fix younger than this is live: speed and engine state are current. */
export const LIVE_FIX_MS = 30 * 60_000;
/** A tracker that has been silent this long reads "no signal" whatever it last reported (and raises an alert). */
export const NO_SIGNAL_MS = 3 * 86_400_000;
export const LOW_FUEL_PCT = 20;

/* ------------------------------------------------------------------ */
/* Oil / PM (the rule itself is serviceStatus in src/lib/service.ts)    */
/* ------------------------------------------------------------------ */

/** What the map carries of serviceStatus(): enough for a line and a colour. */
export type ServiceSnapshot = { state: ServiceState; left: number | null; dueAtKm: number | null; stale: boolean; readingAt: string | null };

/** Oil service needs booking: past the interval or inside OIL_DUE_SOON. */
export const serviceNeeded = (s: ServiceSnapshot) => s.state === "overdue" || s.state === "due_now" || s.state === "due_soon";

/** "Oil 4,043 mi over" · "Oil in 672 mi" · "Oil: no recent reading" · null when no oil change is recorded. */
export function serviceLine(s: ServiceSnapshot, f: Pick<Formatter, "dist">) {
  if (s.state === "unknown" || s.left == null) return null;
  if (s.state === "overdue") return `Oil ${s.stale ? "at least " : ""}${f.dist(-s.left)} over`;
  if (s.state === "no_reading") return "Oil: no recent reading";
  return `Oil in ${f.dist(s.left)}`;
}
export const serviceTone = (s: ServiceSnapshot): Tone => SERVICE_STATE_TONE[s.state];

/* ------------------------------------------------------------------ */
/* Position source                                                     */
/* ------------------------------------------------------------------ */

/**
 * A tracker reports by itself (a device or a telematics integration). A manual position (or one left over from the
 * old route estimate) is just where someone last said the truck was: it never "loses signal", it is only old.
 */
export const isTrackerSource = (src: string | null | undefined) => Boolean(src && src !== "MANUAL" && src !== "SIMULATED");

export const SOURCE_LABEL: Record<string, string> = { MANUAL: "Manual update", SIMULATED: "Manual update", DEVICE: "GPS device", SAMSARA: "Samsara" };
export const sourceLabel = (src: string | null | undefined) => (src ? (SOURCE_LABEL[src] ?? src.charAt(0) + src.slice(1).toLowerCase()) : "No tracker");

/* ------------------------------------------------------------------ */
/* Status on the map                                                   */
/* ------------------------------------------------------------------ */

export const FLEET_STATUSES = ["rolling", "idle", "stopped", "shop", "oos", "nosignal"] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];
export const isFleetStatus = (v: unknown): v is FleetStatus => typeof v === "string" && (FLEET_STATUSES as readonly string[]).includes(v);

export const FLEET_STATUS_LABEL: Record<FleetStatus, string> = {
  rolling: "Rolling", idle: "Idle", stopped: "Stopped", shop: "In shop", oos: "Out of service", nosignal: "No signal",
};
export const FLEET_STATUS_HINT: Record<FleetStatus, string> = {
  rolling: "Moving, live tracker fix",
  idle: "Engine on, not moving",
  stopped: "Parked, or last reported position",
  shop: "In maintenance, or a repair in progress",
  oos: "Held by a defect until someone verifies the repair, or marked out of service",
  nosignal: "No position yet, or the tracker has gone quiet",
};
/** A status colour that is both a UI `Tone` and a map marker tone. */
export type StatusTone = Extract<Tone, "progress" | "info" | "neutral" | "warn" | "danger">;
/**
 * Violet = moving, cyan = idle, grey = parked, orange = shop, red = out of service. No signal is grey too, drawn faded
 * with a dashed ring (we don't know where it is), so red stays for the one state that stops a truck.
 */
export const FLEET_STATUS_TONE: Record<FleetStatus, StatusTone> = {
  rolling: "progress", idle: "info", stopped: "neutral", shop: "warn", oos: "danger", nosignal: "neutral",
};

export type StatusInput = {
  status: string; lat: number | null; lng: number | null; speedKmh: number; engineOn: boolean;
  lastPingAt: string | null; pingSource: string | null; workInProgress: unknown;
  /** Held by a defect, or marked OUT_OF_SERVICE. */
  outOfService?: boolean;
};

export type StatusView = {
  status: FleetStatus;
  /** Age of the last position, ms. Null when there never was one. */
  fixAgeMs: number | null;
  /** A live tracker fix: speed and engine state are current. */
  live: boolean;
  hasPosition: boolean;
};

/**
 * One status per truck, in this order: out of service (defect hold or marked) → in shop (maintenance or a repair in
 * progress) → no position → tracker silent (3 days, or lost while the engine was running) → rolling / idle on a live
 * fix → stopped (parked or last known).
 */
export function fleetStatus(t: StatusInput, now: number): StatusView {
  const hasPosition = t.lat != null && t.lng != null;
  const fixAgeMs = t.lastPingAt ? Math.max(0, now - Date.parse(t.lastPingAt)) : null;
  const tracker = isTrackerSource(t.pingSource);
  const live = tracker && hasPosition && fixAgeMs != null && fixAgeMs < LIVE_FIX_MS;
  let status: FleetStatus;
  if (t.outOfService || t.status === "OUT_OF_SERVICE") status = "oos";
  else if (t.status !== "ACTIVE" || t.workInProgress) status = "shop";
  else if (!hasPosition) status = "nosignal";
  else if (tracker && (fixAgeMs == null || fixAgeMs >= NO_SIGNAL_MS || (!live && t.engineOn))) status = "nosignal";
  else if (live && t.speedKmh > ROLLING_KMH) status = "rolling";
  else if (live && t.engineOn) status = "idle";
  else status = "stopped";
  return { status, fixAgeMs, live, hasPosition };
}

export function countByStatus(trucks: StatusInput[], now: number): Record<FleetStatus, number> {
  const out: Record<FleetStatus, number> = { rolling: 0, idle: 0, stopped: 0, shop: 0, oos: 0, nosignal: 0 };
  for (const t of trucks) out[fleetStatus(t, now).status]++;
  return out;
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

/** "35 min", "2 h 15 min", "3 d". */
export function duration(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.round(h / 24)} d`;
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "just now", "12 min ago", "never". */
export const fixAge = (ms: number | null) => (ms == null ? "never" : ms < 60_000 ? "just now" : `${duration(ms)} ago`);
