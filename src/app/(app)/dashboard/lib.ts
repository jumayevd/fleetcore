import { ALERT_KINDS, ALERT_KIND_HINTS, ALERT_KIND_LABELS, isAlertKind, type Alert, type AlertKind } from "@/lib/alerts";
import { canOpen } from "@/lib/permissions";
import { TIMEZONE } from "@/lib/constants";
import type { Tone } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Alerts → insight groups                                             */
/* ------------------------------------------------------------------ */

export type { AlertKind };
export const KINDS = ALERT_KINDS;
export const KIND_LABEL = ALERT_KIND_LABELS;
export const KIND_HINT = ALERT_KIND_HINTS;
export const isKind = isAlertKind;

// Route gates live in permissions.ts (shared with the shell's alert bell).
export { canOpen };
export const visibleAlerts = (alerts: Alert[], role: string) => alerts.filter((a) => canOpen(role, a.href));

export type AlertGroup = { kind: AlertKind; label: string; items: Alert[]; critical: number; tone: Tone };

/** Group by kind, worst first (ties keep ALERT_KINDS order). Items inside a group keep getAlerts() order. */
export function groupAlerts(alerts: Alert[]): AlertGroup[] {
  const by = new Map<AlertKind, Alert[]>();
  for (const a of alerts) by.set(a.kind, [...(by.get(a.kind) ?? []), a]);
  return [...by]
    .map(([kind, items]) => {
      const critical = items.filter((i) => i.level === "critical").length;
      return { kind, label: KIND_LABEL[kind], items, critical, tone: (critical ? "danger" : "warn") as Tone };
    })
    .sort((a, b) => b.critical - a.critical || b.items.length - a.items.length || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Signed change for a metric note: "+12%" / "-3%". ASCII sign. */
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

/** Whole days from `from` to `to` (never negative). */
export const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
/** Calendar days until `d` from `now`, rounded up: 0 = today, 1 = tomorrow. */
export const daysUntil = (d: Date, now: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
