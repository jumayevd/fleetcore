/**
 * Period selector shared by Maintenance and Reports (server and client safe, no imports). Trailing windows ending now,
 * so a period always compares with one of the same length before it, and the same key means the same numbers on both
 * pages.
 */

const DAY = 86_400_000;

export const PERIODS = {
  week: { days: 7, label: "Week", hint: "Last 7 days" },
  month: { days: 30, label: "Month", hint: "Last 30 days" },
  quarter: { days: 90, label: "Quarter", hint: "Last 90 days" },
  year: { days: 365, label: "Year", hint: "Last 12 months" },
} as const;
export type PeriodKey = keyof typeof PERIODS;
export const DEFAULT_PERIOD: PeriodKey = "quarter";

export function parsePeriod(v: unknown, allowed: readonly PeriodKey[] = Object.keys(PERIODS) as PeriodKey[]): PeriodKey {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as PeriodKey) : DEFAULT_PERIOD;
}

export function periodRange(p: PeriodKey, now = new Date()) {
  const { days } = PERIODS[p];
  const to = now;
  const from = new Date(to.getTime() - days * DAY);
  return { from, to, prevFrom: new Date(from.getTime() - days * DAY), prevTo: from, days };
}
