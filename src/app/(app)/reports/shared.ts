import type { Tone } from "@/components/ui";
import { fromZoned, startOfDayIn, weekStartIn, zonedParts, type CompanyLocale } from "@/lib/locale";

/* Pure helpers for the reports page, its tables and the CSV export (safe on client and server). */

const DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Period selector: trailing windows that start at midnight, company time */
/* ------------------------------------------------------------------ */

export const REPORT_PERIODS = ["month", "quarter", "year"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export const PERIODS: Record<ReportPeriod, { days: number; label: string; hint: string }> = {
  month: { days: 30, label: "Month", hint: "The last 30 days" },
  quarter: { days: 90, label: "Quarter", hint: "The last 90 days" },
  year: { days: 365, label: "Year", hint: "The last 12 months" },
};
export const DEFAULT_PERIOD: ReportPeriod = "quarter";

export const parsePeriod = (v: unknown): ReportPeriod =>
  typeof v === "string" && (REPORT_PERIODS as readonly string[]).includes(v) ? (v as ReportPeriod) : DEFAULT_PERIOD;

export const reportsHref = (p: ReportPeriod) => (p === DEFAULT_PERIOD ? "/reports" : `/reports?period=${p}`);

/** Midnight (company time) `n` calendar days after the day `d` falls on; n may be negative. DST-safe. */
export function shiftDays(d: Date, n: number, tz: string) {
  const p = zonedParts(new Date(d.getTime() + 12 * 3_600_000), tz);
  return fromZoned(p.y, p.m, p.d + n, 0, 0, tz);
}

/**
 * The period as company time: from midnight `days - 1` days before today up to now, so "the last 30 days" is today and
 * the 29 days before it on the company's own calendar. The comparison window is the same length, right before it.
 */
export function periodRange(p: ReportPeriod, locale: CompanyLocale, now = new Date()) {
  const { days } = PERIODS[p];
  const today = startOfDayIn(now, locale.timezone);
  const from = shiftDays(today, -(days - 1), locale.timezone);
  const to = now;
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
  return { from, to, prevFrom, prevTo: from, days };
}

/* ------------------------------------------------------------------ */
/* Calendar buckets in company time                                    */
/* ------------------------------------------------------------------ */

export type Bucket = {
  /** yyyy-MM for months, yyyy-MM-dd (first day) for weeks. */
  key: string;
  from: Date;
  /** Exclusive; the current bucket runs to now. */
  to: Date;
  /** The current month / week, which runs to now. */
  partial: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The last `count` calendar months including the current one, oldest first, in company time. */
export function monthBuckets(count: number, locale: CompanyLocale, now = new Date()): Bucket[] {
  const tz = locale.timezone;
  const p = zonedParts(now, tz);
  return Array.from({ length: count }, (_, i) => {
    const offset = i - (count - 1);
    const from = fromZoned(p.y, p.m + offset, 1, 0, 0, tz);
    const next = fromZoned(p.y, p.m + offset + 1, 1, 0, 0, tz);
    const s = zonedParts(new Date(from.getTime() + 12 * 3_600_000), tz);
    const last = i === count - 1;
    return { key: `${s.y}-${pad(s.m)}`, from, to: last ? now : next, partial: last };
  });
}

/** The last `count` weeks including the current one, oldest first. Weeks start on Sunday (imperial) or Monday (metric). */
export function weekBuckets(count: number, locale: CompanyLocale, now = new Date()): Bucket[] {
  const current = weekStartIn(now, locale);
  return Array.from({ length: count }, (_, i) => {
    const back = count - 1 - i;
    const start = weekStartIn(shiftDays(current.at, -7 * back, locale.timezone), locale);
    const next = shiftDays(start.at, 7, locale.timezone);
    return { key: start.key, from: start.at, to: back === 0 ? now : next, partial: back === 0 };
  });
}

/** Months in the running-cost chart: half a year for the short periods, a year for the year. */
export const CHART_MONTHS: Record<ReportPeriod, number> = { month: 6, quarter: 6, year: 12 };
/** Weeks in the inspection charts: the weeks the period touches. */
export const CHART_WEEKS: Record<ReportPeriod, number> = { month: 5, quarter: 13, year: 52 };

/** Repeat repairs: the same system on the same unit this many times … */
export const REPEAT_VISITS = 2;
/** … within this many days. */
export const REPEAT_WINDOW_DAYS = 90;
/** Systems that come back by design (oil changes) or are not a fault (fees), so never count as a repeat problem. */
export const REPEAT_IGNORED_SYSTEMS = ["PM", "FEES"] as const;

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

export const EXPORT_TYPES = [
  "trucks", "monthly", "repair-types", "vendors", "systems", "repeats", "downtime", "driver-charges", "warranty",
  "defects", "walkarounds", "roadside",
] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export const isExportType = (v: unknown): v is ExportType => typeof v === "string" && (EXPORT_TYPES as readonly string[]).includes(v);
export const exportHref = (type: ExportType, p: ReportPeriod) => `/api/export/report?type=${type}&period=${p}`;

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

/** A truck needs this much distance (company unit) in the window before its fuel economy or cost is compared. */
export const MIN_DISTANCE_TO_COMPARE = 1000;
/** Fuel burn this far worse than the fleet average is worth a look (driving style, idling, leaks, a fuel card). */
export const HIGH_BURN = 1.15;
/** Cost per distance this far above the fleet average is worth a look. */
export const HIGH_COST_PER_DISTANCE = 1.5;

/* ------------------------------------------------------------------ */
/* Maths and formatting                                                */
/* ------------------------------------------------------------------ */

/** A step of 1, 2, 2.5 or 5 × 10ⁿ, so a chart axis reads in round amounts. */
export function niceStep(raw: number, integer = false) {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  return integer ? Math.max(1, Math.ceil(step)) : step;
}

export const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
export const share = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
export const fmtDays = (v: number) => (v === 0 ? "0 days" : v < 10 ? `${v.toFixed(1)} days` : `${Math.round(v)} days`);
export const daysBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / DAY);

/**
 * Whether `value` burns more fuel than `avg` by the HIGH_BURN margin. MPG: lower is worse; L/100 km: higher is worse.
 */
export const burnsHigh = (value: number, avg: number, higherIsBetter: boolean) =>
  higherIsBetter ? value <= avg / HIGH_BURN : value >= avg * HIGH_BURN;

/** Percent change from the previous period; null when there is nothing to compare with. */
export const deltaPct = (cur: number | null | undefined, prev: number | null | undefined): number | null =>
  cur != null && prev != null && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
export const fmtDelta = (n: number | null) => (n == null ? undefined : `${n > 0 ? "+" : ""}${n}%`);
/** Costs, defects and downtime going up deserve a look; going down is good. */
export const costDeltaTone = (n: number | null): Tone => (n == null || n === 0 ? "neutral" : n > 0 ? "warn" : "ok");
/** Fuel economy: MPG going up is good, L/100 km going up is not. */
export const economyDeltaTone = (n: number | null, higherIsBetter: boolean): Tone =>
  n == null || n === 0 ? "neutral" : (n > 0) === higherIsBetter ? "ok" : "warn";

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-muted", accent: "text-accent-text", ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info", progress: "text-progress",
};

/** "1 job" / "3 jobs". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Shown wherever a figure would be money and the role cannot see money. */
export const MONEY_HIDDEN = "Costs are shown to owners, admins and fleet specialists.";
