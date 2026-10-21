import type { Decision } from "./decision-types";
import { canOpen } from "@/lib/permissions";

export { canOpen };

/** Rows this role can open (a role without access to drivers, say, never sees driver rows). */
export const visibleDecisions = (rows: Decision[], role: string) => rows.filter((d) => canOpen(role, d.view.href));

/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Signed change for a metric note: "+12%" / "-3%". ASCII sign. */
export const pct = (d: number) => `${d > 0 ? "+" : ""}${d}%`;

/** Whole days from `from` to `to` (never negative). */
export const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
/** Calendar days until `d` from `now`, rounded up: 0 = today, 1 = tomorrow. */
export const daysUntil = (d: Date, now: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);

/** Downtime clock: "12 d 9 h", "5 h", "40 min". */
export function downtime(from: Date, now: Date) {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}
