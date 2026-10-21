import { startOfMonth, subMonths } from "date-fns";
import type { Tone } from "@/components/ui";

/* Pure helpers for the reports page, its tables and the CSV export (safe on client and server). */

const DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Period selector                                                     */
/* ------------------------------------------------------------------ */

/** Rolling windows for the short periods; whole calendar months (ending today) for the long ones. */
export const PERIODS = {
  "30d": { label: "30 days", days: 30, months: 0 },
  "90d": { label: "90 days", days: 90, months: 0 },
  "6m": { label: "6 months", days: 0, months: 6 },
  "12m": { label: "12 months", days: 0, months: 12 },
} as const;
export type PeriodKey = keyof typeof PERIODS;
export const PERIOD_KEYS = Object.keys(PERIODS) as PeriodKey[];
const DEFAULT_PERIOD: PeriodKey = "90d";

export function parsePeriod(v: unknown): PeriodKey {
  return typeof v === "string" && v in PERIODS ? (v as PeriodKey) : DEFAULT_PERIOD;
}

export function periodRange(p: PeriodKey, now = new Date()) {
  const def = PERIODS[p];
  if (def.months) {
    const from = startOfMonth(subMonths(now, def.months - 1));
    const days = Math.max(1, Math.round((now.getTime() - from.getTime()) / DAY));
    return { from, to: now, prevFrom: subMonths(from, def.months), prevTo: from, days, months: def.months };
  }
  const from = new Date(now.getTime() - def.days * DAY);
  return { from, to: now, prevFrom: new Date(from.getTime() - def.days * DAY), prevTo: from, days: def.days, months: 0 };
}

export const reportsHref = (p: PeriodKey) => (p === DEFAULT_PERIOD ? "/reports" : `/reports?period=${p}`);

export const EXPORT_TYPES = ["lanes", "drivers", "trucks"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export const isExportType = (v: unknown): v is ExportType => typeof v === "string" && (EXPORT_TYPES as readonly string[]).includes(v);
export const exportHref = (type: ExportType, p: PeriodKey) => `/api/export/report?type=${type}&period=${p}`;

/* ------------------------------------------------------------------ */
/* Maths and formatting                                                */
/* ------------------------------------------------------------------ */

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
export const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
export const fmtPerKm = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(2)}`);

/** Percent change from the previous period; null when there is nothing to compare with. */
export const deltaPct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
export const fmtDelta = (n: number | null) => (n == null ? undefined : `${n > 0 ? "+" : ""}${n}%`);
export const fmtPts = (n: number | null) => (n == null ? undefined : `${n > 0 ? "+" : ""}${n} pts`);
/** Tone for a delta where up is good (revenue) or bad (empty km). */
export const deltaTone = (n: number | null, upIsGood = true): Tone | undefined =>
  n == null || n === 0 ? "neutral" : (n > 0) === upIsGood ? "ok" : "danger";

export const marginTone = (p: number): Tone => (p < 15 ? "danger" : p < 25 ? "warn" : "ok");
// Same thresholds as the driver and customer pages (95 % on time is the target).
export const onTimeTone = (p: number): Tone => (p >= 95 ? "ok" : p >= 85 ? "warn" : "danger");
export const emptyTone = (p: number): Tone => (p > 20 ? "danger" : p > 12 ? "warn" : "ok");
export const scoreTone = (s: number): Tone => (s >= 90 ? "ok" : s >= 75 ? "warn" : "danger");

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-muted", accent: "text-accent-text", ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info", progress: "text-progress",
};
