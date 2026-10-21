// Calendar dates and clock times in the company timezone (TIMEZONE), for the daily and weekly boards.
// Client-safe (Intl only, no server imports). Board components format through these instead of date-fns so the
// server render (UTC on Vercel) and the browser (the dispatcher's zone) produce identical strings.

import { TIMEZONE } from "@/lib/constants";

export const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Wall-clock parts of an instant in the company timezone (numeric, so output never depends on the ICU locale data). */
function tzParts(at: Date | string | number) {
  const parts = partsFmt.formatToParts(at instanceof Date ? at : new Date(at));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute"), s: g("second") };
}

function tzOffsetMs(at: Date) {
  const p = tzParts(at);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - at.getTime()) / 60_000) * 60_000;
}

/* ---------- calendar dates (YYYY-MM-DD) ---------- */

/** A real calendar date in YYYY-MM-DD form (2026-02-30 and 2026-13-45 are rejected, not rolled over). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Calendar date of an instant in the company timezone. */
export function ymdOf(at: Date | string | number) {
  const p = tzParts(at);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Today's date in the company timezone. Server-side only at render time (reads the clock). */
export const todayYmd = () => ymdOf(new Date());

export const shiftYmd = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday. */
const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
export const isWeekendYmd = (ymd: string) => weekdayOf(ymd) === 0 || weekdayOf(ymd) === 6;

/** Monday of the week containing `ymd`. */
export const mondayOf = (ymd: string) => shiftYmd(ymd, -((weekdayOf(ymd) + 6) % 7));

/** Instant the calendar day starts in the company timezone. */
export function dayStart(ymd: string) {
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  // Two passes so a DST change on that day still lands on local midnight.
  const guess = utcMidnight - tzOffsetMs(new Date(utcMidnight));
  return new Date(utcMidnight - tzOffsetMs(new Date(guess)));
}

/** [start, end) of a calendar day in the company timezone. */
export const dayRange = (ymd: string) => ({ start: dayStart(ymd), end: dayStart(shiftYmd(ymd, 1)) });

const ymdNums = (ymd: string) => ({ y: Number(ymd.slice(0, 4)), mo: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) });
/** "Mon" */
export const ymdWeekday = (ymd: string) => WEEKDAYS[weekdayOf(ymd)];
/** "28 Sep" */
export const ymdDayMonth = (ymd: string) => { const p = ymdNums(ymd); return `${p.d} ${MONTHS[p.mo - 1]}`; };
/** "28 Sep 2026" */
export const ymdDayMonthYear = (ymd: string) => `${ymdDayMonth(ymd)} ${ymdNums(ymd).y}`;
/** "Monday, 28 September 2026" */
export const ymdLong = (ymd: string) => { const p = ymdNums(ymd); return `${WEEKDAYS_LONG[weekdayOf(ymd)]}, ${p.d} ${MONTHS_LONG[p.mo - 1]} ${p.y}`; };

/* ---------- instants (ISO strings) in company time ---------- */

/** "13:14" */
export const fmtHm = (iso: string | null | undefined) => { if (!iso) return ""; const p = tzParts(iso); return `${pad(p.h)}:${pad(p.mi)}`; };
/** "13:14:05" */
export const fmtHms = (iso: string | null | undefined) => { if (!iso) return ""; const p = tzParts(iso); return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`; };
/** "04 Oct" */
export const fmtDayMonth = (iso: string | null | undefined) => { if (!iso) return ""; const p = tzParts(iso); return `${pad(p.d)} ${MONTHS[p.mo - 1]}`; };
/** "04 Oct, 13:14" — same shape as dateTime() in lib/format, but always in company time. */
export const fmtDateTime = (iso: Date | string | null | undefined) => {
  if (!iso) return "—";
  const p = tzParts(iso);
  return `${pad(p.d)} ${MONTHS[p.mo - 1]}, ${pad(p.h)}:${pad(p.mi)}`;
};
