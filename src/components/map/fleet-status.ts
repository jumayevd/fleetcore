import type { Tone } from "@/components/ui";

/**
 * Live-fleet rules shared by the live map (client), the overview and the alerts (server). A plain module: no
 * "use client", no server-only, so both sides compute "rolling", "no signal" and "PM due" the same way.
 */

/** Above this a truck is rolling; at or below it is idle or stopped. */
export const ROLLING_KMH = 5;
/** A tracker fix younger than this is live: speed and engine state are current. */
export const LIVE_FIX_MS = 30 * 60_000;
/** A tracker that has been silent this long reads "no signal" whatever it last reported (and raises an alert). */
export const NO_SIGNAL_MS = 3 * 86_400_000;
export const LOW_FUEL_PCT = 20;
/** PM counts as due inside this many km of the next service (same window as the truck page). */
export const PM_DUE_SOON_KM = 2000;

/* ------------------------------------------------------------------ */
/* Preventive maintenance                                              */
/* ------------------------------------------------------------------ */

export type PmState = "unknown" | "ok" | "due" | "overdue";
export type PmInput = { odometerKm: number; pmIntervalKm: number; lastPmKm: number | null; nextServiceKm: number | null };

/** Next service is the explicit `nextServiceKm`, else last PM + interval. `leftKm` < 0 means overdue. */
export function pmState(t: PmInput): { nextKm: number | null; leftKm: number | null; state: PmState } {
  const nextKm = t.nextServiceKm ?? (t.lastPmKm != null ? t.lastPmKm + t.pmIntervalKm : null);
  if (nextKm == null) return { nextKm: null, leftKm: null, state: "unknown" };
  const leftKm = nextKm - t.odometerKm;
  return { nextKm, leftKm, state: leftKm < 0 ? "overdue" : leftKm < PM_DUE_SOON_KM ? "due" : "ok" };
}

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

export const FLEET_STATUSES = ["rolling", "idle", "stopped", "shop", "nosignal"] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];
export const isFleetStatus = (v: unknown): v is FleetStatus => typeof v === "string" && (FLEET_STATUSES as readonly string[]).includes(v);

export const FLEET_STATUS_LABEL: Record<FleetStatus, string> = {
  rolling: "Rolling", idle: "Idle", stopped: "Stopped", shop: "In shop", nosignal: "No signal",
};
export const FLEET_STATUS_HINT: Record<FleetStatus, string> = {
  rolling: "Moving, live tracker fix",
  idle: "Engine on, not moving",
  stopped: "Parked, or last reported position",
  shop: "In maintenance, out of service, or a work order in progress",
  nosignal: "No position yet, or the tracker has gone quiet",
};
/** A status colour that is both a UI `Tone` and a map marker tone. */
export type StatusTone = Extract<Tone, "progress" | "info" | "neutral" | "warn" | "danger">;
/** Violet = moving, cyan = idle, grey = parked, orange = shop, red = no signal. */
export const FLEET_STATUS_TONE: Record<FleetStatus, StatusTone> = {
  rolling: "progress", idle: "info", stopped: "neutral", shop: "warn", nosignal: "danger",
};

export type StatusInput = {
  status: string; lat: number | null; lng: number | null; speedKmh: number; engineOn: boolean;
  lastPingAt: string | null; pingSource: string | null; workInProgress: unknown;
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
 * One status per truck, in this order: in shop (status or a job in progress) → no position → tracker silent
 * (3 days, or lost while the engine was running) → rolling / idle on a live fix → stopped (parked or last known).
 */
export function fleetStatus(t: StatusInput, now: number): StatusView {
  const hasPosition = t.lat != null && t.lng != null;
  const fixAgeMs = t.lastPingAt ? Math.max(0, now - Date.parse(t.lastPingAt)) : null;
  const tracker = isTrackerSource(t.pingSource);
  const live = tracker && hasPosition && fixAgeMs != null && fixAgeMs < LIVE_FIX_MS;
  let status: FleetStatus;
  if (t.status !== "ACTIVE" || t.workInProgress) status = "shop";
  else if (!hasPosition) status = "nosignal";
  else if (tracker && (fixAgeMs == null || fixAgeMs >= NO_SIGNAL_MS || (!live && t.engineOn))) status = "nosignal";
  else if (live && t.speedKmh > ROLLING_KMH) status = "rolling";
  else if (live && t.engineOn) status = "idle";
  else status = "stopped";
  return { status, fixAgeMs, live, hasPosition };
}

export function countByStatus(trucks: StatusInput[], now: number): Record<FleetStatus, number> {
  const out = { rolling: 0, idle: 0, stopped: 0, shop: 0, nosignal: 0 };
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

const kmFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** "PM in 1,200 km" / "PM 300 km overdue" / null when no PM is set up. */
export function pmLabel(leftKm: number | null) {
  if (leftKm == null) return null;
  return leftKm < 0 ? `PM ${kmFmt.format(-leftKm)} km overdue` : `PM in ${kmFmt.format(leftKm)} km`;
}
