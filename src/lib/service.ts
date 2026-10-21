/*
 * Oil change / PM status by odometer — one rule for the Today page, trucks, the oil board, alerts and the assistant.
 * Client-safe. Distances are in the company's own unit (see src/lib/locale.ts).
 *
 *  - The interval is the truck type's (oilIntervalKm) when the truck has a type, else the truck's own pmIntervalKm.
 *  - Due at = last oil change odometer + interval (nextServiceKm only when no last change is recorded).
 *  - The odometer is only as good as its reading: older than STALE_READING_DAYS, "used" is a lower bound
 *    ("≥ 24,000 used as of Sep 24") and a unit that is not already past its interval shows "no reading" instead of
 *    pretending to be on schedule.
 */

export const STALE_READING_DAYS = 14;
/** Book it this week. */
export const OIL_DUE_SOON = 3000;
/** Book it before the next trip. */
export const OIL_DUE_NOW = 1000;

export type ServiceState = "overdue" | "due_now" | "due_soon" | "ok" | "no_reading" | "unknown";

export type ServiceInput = {
  odometerKm: number;
  odometerAt?: Date | string | null;
  pmIntervalKm: number;
  lastPmKm: number | null;
  lastPmAt?: Date | string | null;
  nextServiceKm?: number | null;
  truckType?: { name?: string; oilIntervalKm: number } | null;
};

export type ServiceStatus = {
  interval: number;
  /** Where the interval came from: the truck type's name, or null for the truck's own interval. */
  intervalFrom: string | null;
  lastKm: number | null;
  dueAtKm: number | null;
  /** Distance used since the last change (a lower bound when `stale`). */
  used: number | null;
  /** Distance left to the due odometer; negative = over. */
  left: number | null;
  state: ServiceState;
  /** The odometer reading is older than STALE_READING_DAYS (or has no date). */
  stale: boolean;
  readingAt: Date | null;
  /** Share of the interval used (0–1+), for a progress bar. */
  pct: number | null;
};

const asDate = (d: Date | string | null | undefined) => (d ? new Date(d) : null);

export function serviceStatus(t: ServiceInput, now: Date = new Date()): ServiceStatus {
  const interval = t.truckType?.oilIntervalKm ?? t.pmIntervalKm;
  const intervalFrom = t.truckType?.oilIntervalKm ? (t.truckType.name ?? "truck type") : null;
  const readingAt = asDate(t.odometerAt);
  const stale = !readingAt || now.getTime() - readingAt.getTime() > STALE_READING_DAYS * 86_400_000;
  const lastKm = t.lastPmKm;
  const dueAtKm = lastKm != null ? lastKm + interval : (t.nextServiceKm ?? null);
  if (dueAtKm == null) return { interval, intervalFrom, lastKm, dueAtKm: null, used: null, left: null, state: "unknown", stale, readingAt, pct: null };
  const used = lastKm != null ? Math.max(0, t.odometerKm - lastKm) : null;
  const left = dueAtKm - t.odometerKm;
  const pct = used != null && interval > 0 ? used / interval : null;
  let state: ServiceState;
  if (left < 0) state = "overdue"; // past the limit: a stale reading only means it is at least this far over
  else if (stale) state = "no_reading";
  else if (left <= OIL_DUE_NOW) state = "due_now";
  else if (left <= OIL_DUE_SOON) state = "due_soon";
  else state = "ok";
  return { interval, intervalFrom, lastKm, dueAtKm, used, left, state, stale, readingAt, pct };
}

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  overdue: "Overdue", due_now: "Due now", due_soon: "Due soon", ok: "On schedule", no_reading: "No recent reading", unknown: "No oil change recorded",
};

/** Badge tone per state (see Tone in src/components/ui.tsx). */
export const SERVICE_STATE_TONE: Record<ServiceState, "danger" | "warn" | "info" | "ok" | "neutral"> = {
  overdue: "danger", due_now: "warn", due_soon: "info", ok: "ok", no_reading: "neutral", unknown: "neutral",
};

/* ------------------------------------------------------------------ */
/* Record numbers                                                      */
/* ------------------------------------------------------------------ */

const pad4 = (n: number) => String(n).padStart(4, "0");
/** Repair order number as people say it: RO-0137. */
export const roLabel = (n: number) => `RO-${pad4(n)}`;
/** Defect number: DEF-0021. */
export const defectLabel = (n: number) => `DEF-${pad4(n)}`;
