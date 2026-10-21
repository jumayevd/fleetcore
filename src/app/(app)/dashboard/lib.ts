import type { Alert } from "@/lib/alerts";
import type { FleetSnapshot } from "@/lib/telemetry";
import { canOpen } from "@/lib/permissions";
import { TIMEZONE } from "@/lib/constants";
import type { Tone } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Alerts → insight groups                                             */
/* ------------------------------------------------------------------ */

export type AlertKind = Alert["kind"];

export const KIND_LABEL: Record<AlertKind, string> = {
  compliance: "Compliance", dispatch: "Dispatch", fleet: "Fleet", money: "Money", safety: "Safety",
};
export const KINDS: AlertKind[] = ["dispatch", "compliance", "fleet", "money", "safety"];
export const isKind = (v: unknown): v is AlertKind => typeof v === "string" && (KINDS as string[]).includes(v);

// Route gates live in permissions.ts (shared with the shell's alert bell).
export { canOpen };
export const visibleAlerts = (alerts: Alert[], role: string) => alerts.filter((a) => canOpen(role, a.href));

export type AlertGroup = { kind: AlertKind; label: string; items: Alert[]; critical: number; tone: Tone };

/** Group by kind, worst first. Items inside a group keep getAlerts() order (critical first). */
export function groupAlerts(alerts: Alert[]): AlertGroup[] {
  const by = new Map<AlertKind, Alert[]>();
  for (const a of alerts) by.set(a.kind, [...(by.get(a.kind) ?? []), a]);
  return [...by]
    .map(([kind, items]) => {
      const critical = items.filter((i) => i.level === "critical").length;
      return { kind, label: KIND_LABEL[kind], items, critical, tone: (critical ? "danger" : "warn") as Tone };
    })
    .sort((a, b) => b.critical - a.critical || b.items.length - a.items.length);
}

/* ------------------------------------------------------------------ */
/* Fleet                                                               */
/* ------------------------------------------------------------------ */

/** Same thresholds the live map uses: above this a truck counts as moving; a fix older than this is "no signal". */
const ROLLING_KMH = 5;
const STALE_MS = 30 * 60_000;

export const movingTrucks = (fleet: Pick<FleetSnapshot[number], "status" | "speedKmh">[]) =>
  fleet.filter((t) => t.status === "ACTIVE" && t.speedKmh > ROLLING_KMH).length;

type SnapshotLoad = NonNullable<FleetSnapshot[number]["load"]>;
/** In transit and projected to arrive after the delivery deadline. Numeric compare, like alerts.ts and the live map. */
export const isRunningLate = (load: Pick<SnapshotLoad, "status" | "eta" | "deliveryAt"> | null) =>
  Boolean(load && load.status === "IN_TRANSIT" && load.eta && Date.parse(load.eta) > Date.parse(load.deliveryAt));

export type FleetLegend = ReturnType<typeof fleetLegend>;
/** The live map's legend, computed once on the server for roles that cannot poll /api/fleet. */
export function fleetLegend(fleet: FleetSnapshot, now: number) {
  const out = { trucks: fleet.length, rolling: 0, idle: 0, stopped: 0, inService: 0, onLoad: 0, late: 0, noSignal: 0 };
  for (const t of fleet) {
    const fixAge = t.lastPingAt ? Math.max(0, now - Date.parse(t.lastPingAt)) : null;
    const fresh = fixAge != null && fixAge < STALE_MS;
    if (t.status !== "ACTIVE") out.inService++;
    else if (t.speedKmh > ROLLING_KMH) out.rolling++;
    else if (t.engineOn || fresh) out.idle++;
    else out.stopped++;
    if (t.load) {
      out.onLoad++;
      if (!fresh) out.noSignal++;
      if (isRunningLate(t.load)) out.late++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Percentage-point delta for Stat tiles: "+3 pts" / "-2 pts" / "0 pts". Sign is ASCII so Stat can read it. */
export const pts = (d: number) => `${d > 0 ? "+" : ""}${d} pts`;
export const pct = (d: number) => `${d > 0 ? "+" : ""}${d}%`;

/** Company-local hour, so the greeting is right even when the server runs elsewhere. */
function companyHour(now: Date) {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(now);
  return Number(h) % 24;
}
export const greeting = (now: Date) => {
  const h = companyHour(now);
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
export const longDate = (now: Date) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE }).format(now);
