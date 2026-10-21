import type { Tone } from "@/components/ui";
import { money2 } from "@/lib/format";
import { DEFAULT_PERIOD, PERIODS, parsePeriod as parseAnyPeriod, type PeriodKey } from "@/app/(app)/maintenance/_lib/period";

/* Pure helpers for the reports page, its tables and the CSV export (safe on client and server). */

/* ------------------------------------------------------------------ */
/* Period selector: the same trailing windows as Maintenance           */
/* ------------------------------------------------------------------ */

export const REPORT_PERIODS = ["month", "quarter", "year"] as const satisfies readonly PeriodKey[];
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export { PERIODS };

export const parsePeriod = (v: unknown) => parseAnyPeriod(v, REPORT_PERIODS) as ReportPeriod;

/** Calendar months in the running-cost chart: half a year for the short periods, a year for the year. */
export const CHART_MONTHS: Record<ReportPeriod, number> = { month: 6, quarter: 6, year: 12 };

export const reportsHref = (p: ReportPeriod) => (p === DEFAULT_PERIOD ? "/reports" : `/reports?period=${p}`);

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

export const EXPORT_TYPES = ["trucks", "monthly", "categories", "vendors", "downtime"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export const isExportType = (v: unknown): v is ExportType => typeof v === "string" && (EXPORT_TYPES as readonly string[]).includes(v);
export const exportHref = (type: ExportType, p: ReportPeriod) => `/api/export/report?type=${type}&period=${p}`;

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

/** A truck needs this many km in the window before its fuel economy or cost per km is compared with the fleet. */
export const MIN_KM_TO_COMPARE = 1000;
/** Fuel economy this far above the fleet average is worth a look (driving style, idling, leaks, a fuel card). */
export const HIGH_L100 = 1.15;
/** Cost per km this far above the fleet average is worth a look. */
export const HIGH_COST_PER_KM = 1.5;

/* ------------------------------------------------------------------ */
/* Maths and formatting                                                */
/* ------------------------------------------------------------------ */

export const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
export const share = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
export const fmtPerKm = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : money2(v));
export const fmtL100 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)} L/100 km`);
export const fmtDays = (v: number) => (v === 0 ? "0 days" : v < 10 ? `${v.toFixed(1)} days` : `${Math.round(v)} days`);

/** Percent change from the previous period; null when there is nothing to compare with. */
export const deltaPct = (cur: number | null | undefined, prev: number | null | undefined): number | null =>
  cur != null && prev != null && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
export const fmtDelta = (n: number | null) => (n == null ? undefined : `${n > 0 ? "+" : ""}${n}%`);
/** Costs, fuel burn and downtime going up deserve a look; going down is good. */
export const costDeltaTone = (n: number | null): Tone => (n == null || n === 0 ? "neutral" : n > 0 ? "warn" : "ok");

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-muted", accent: "text-accent-text", ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info", progress: "text-progress",
};
