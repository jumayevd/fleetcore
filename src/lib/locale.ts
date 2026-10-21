/*
 * Per-company units, time zone and currency. Client-safe (no Prisma, no server-only imports).
 *
 * A company is "imperial" (miles, gallons, MPG, lb, mph; US dates like "Oct 21, 2026, 9:32 AM") or "metric"
 * (km, litres, L/100 km, kg, km/h; "21 Oct 2026, 09:32"). Values are STORED in the company's own system — a field
 * named odometerKm holds miles for an imperial company — so nothing is converted on the way in or out; only labels
 * and fuel-economy maths depend on the system.
 *
 * Server components: `const f = await getFormat()` (src/lib/format-server.ts). Client components: `const f = useFormat()`
 * (src/components/locale.tsx). Both give the same Formatter.
 */

export type UnitSystem = "imperial" | "metric";
export type CompanyLocale = { units: UnitSystem; timezone: string; currency: string };

export const DEFAULT_LOCALE: CompanyLocale = { units: "imperial", timezone: "America/New_York", currency: "USD" };

export const UNIT_SYSTEMS: { value: UnitSystem; label: string; hint: string }[] = [
  { value: "imperial", label: "Imperial (US)", hint: "Miles, gallons, MPG, pounds" },
  { value: "metric", label: "Metric", hint: "Kilometres, litres, L/100 km, kilograms" },
];

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "UZS", "KZT", "RUB"] as const;

/** Time zones offered first; any IANA zone is accepted. */
export const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage",
  "America/Toronto", "Europe/London", "Europe/Berlin", "Europe/Istanbul", "Asia/Tashkent", "Asia/Almaty", "Asia/Dubai",
] as const;

export const isUnitSystem = (v: unknown): v is UnitSystem => v === "imperial" || v === "metric";

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeLocale(c: { units?: string | null; timezone?: string | null; currency?: string | null } | null | undefined): CompanyLocale {
  return {
    units: isUnitSystem(c?.units) ? c.units : DEFAULT_LOCALE.units,
    timezone: isTimeZone(c?.timezone) ? c.timezone : DEFAULT_LOCALE.timezone,
    currency: typeof c?.currency === "string" && /^[A-Z]{3}$/.test(c.currency) ? c.currency : DEFAULT_LOCALE.currency,
  };
}

export function unitLabels(units: UnitSystem) {
  const imperial = units === "imperial";
  return {
    distance: imperial ? "mi" : "km",
    distanceLong: imperial ? "miles" : "kilometres",
    volume: imperial ? "gal" : "L",
    volumeLong: imperial ? "gallons" : "litres",
    economy: imperial ? "MPG" : "L/100 km",
    /** MPG: more is better. L/100 km: less is better. */
    economyHigherIsBetter: imperial,
    weight: imperial ? "lb" : "kg",
    speed: imperial ? "mph" : "km/h",
    /** Per-distance rate label: "per mi" / "per km". */
    perDistance: imperial ? "per mi" : "per km",
  };
}

/** US zones (and the few others that run on miles) default to imperial; everywhere else to metric. */
const IMPERIAL_ZONES = /^(America\/(New_York|Detroit|Chicago|Denver|Phoenix|Boise|Los_Angeles|Anchorage|Juneau|Adak|Nome|Sitka|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+|Menominee)|Pacific\/Honolulu|US\/.+)$/;
const ZONE_CURRENCY: [RegExp, string][] = [
  [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns|Montreal)$/, "CAD"],
  [/^Europe\/London$/, "GBP"],
  [/^Europe\/(Moscow|Samara|Volgograd)$/, "RUB"],
  [/^Asia\/(Tashkent|Samarkand)$/, "UZS"],
  [/^Asia\/(Almaty|Aqtobe|Aqtau|Oral|Qyzylorda|Atyrau)$/, "KZT"],
  [/^Europe\//, "EUR"],
];

/** A sensible starting locale for a new company, from the time zone of the browser that creates it. */
export function guessLocale(tz: string | null | undefined, units?: UnitSystem | null): CompanyLocale {
  const timezone = isTimeZone(tz) ? tz : DEFAULT_LOCALE.timezone;
  const u = units ?? (IMPERIAL_ZONES.test(timezone) ? "imperial" : "metric");
  const currency = u === "imperial" && IMPERIAL_ZONES.test(timezone) ? "USD" : (ZONE_CURRENCY.find(([re]) => re.test(timezone))?.[1] ?? "USD");
  return { units: u, timezone, currency };
}

/** City part of an IANA zone: "America/New_York" → "New York". */
export const zoneCity = (tz: string) => (tz.split("/").pop() ?? tz).replace(/_/g, " ");

/* ------------------------------------------------------------------ */
/* Time zone arithmetic (no library)                                   */
/* ------------------------------------------------------------------ */

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number; weekday: number };

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormat(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    partsCache.set(tz, f);
  }
  return f;
}
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of an instant in `tz`. */
export function zonedParts(date: Date, tz: string): Parts {
  const p = Object.fromEntries(partsFormat(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, weekday: WEEKDAYS.indexOf(p.weekday) };
}

/** The instant at which the wall clock in `tz` reads y-m-d h:mi (m is 1–12). */
export function fromZoned(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess;
  // Two passes settle the offset, including across DST changes.
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(t), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    t += guess - asUtc;
  }
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant in `tz`. */
export function dayKey(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Midnight (company time) of the day `date` falls on. */
export function startOfDayIn(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  return fromZoned(p.y, p.m, p.d, 0, 0, tz);
}

/** First day of the week `date` falls in: Sunday for imperial companies, Monday for metric. */
export function weekStartIn(date: Date, locale: CompanyLocale) {
  const p = zonedParts(date, locale.timezone);
  const back = locale.units === "imperial" ? p.weekday : (p.weekday + 6) % 7;
  const noon = fromZoned(p.y, p.m, p.d, 12, 0, locale.timezone);
  const start = new Date(noon.getTime() - back * 86_400_000);
  const s = zonedParts(start, locale.timezone);
  return {
    /** The instant the week starts (00:00 company time). */
    at: fromZoned(s.y, s.m, s.d, 0, 0, locale.timezone),
    /** As a calendar date "YYYY-MM-DD" (what @db.Date columns store). */
    key: `${s.y}-${pad(s.m)}-${pad(s.d)}`,
  };
}

/** A @db.Date value (stored as UTC midnight) for a "YYYY-MM-DD" key. */
export const dateOnly = (key: string) => new Date(`${key}T00:00:00.000Z`);

/** Parse an <input type="date"> value as midnight in `tz`. */
export function parseDateInput(v: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? fromZoned(+m[1], +m[2], +m[3], 0, 0, tz) : null;
}

/** Parse an <input type="datetime-local"> value as wall-clock time in `tz`. */
export function parseDateTimeInput(v: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  return m ? fromZoned(+m[1], +m[2], +m[3], +m[4], +m[5], tz) : null;
}

/* ------------------------------------------------------------------ */
/* Formatter                                                           */
/* ------------------------------------------------------------------ */

export type Formatter = ReturnType<typeof makeFormat>;
type When = Date | string | number | null | undefined;
const toDate = (d: When) => (d == null || d === "" ? null : d instanceof Date ? d : new Date(d));

export function makeFormat(input: CompanyLocale) {
  const locale = normalizeLocale(input);
  const { units, timezone: tz, currency } = locale;
  const imperial = units === "imperial";
  const labels = unitLabels(units);
  const lang = imperial ? "en-US" : "en-GB";
  const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const c0 = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 });
  const c2 = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const c3 = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fDate = new Intl.DateTimeFormat(lang, { day: imperial ? "numeric" : "2-digit", month: "short", year: "numeric", timeZone: tz });
  const fDay = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: tz });
  const fWeekday = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", timeZone: tz });
  const fDateTime = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: imperial, timeZone: tz });
  const fTime = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: imperial, timeZone: tz });
  const fZone = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });

  const economy = (distance: number | null | undefined, volume: number | null | undefined): number | null => {
    if (!distance || !volume || distance <= 0 || volume <= 0) return null;
    return imperial ? distance / volume : (volume / distance) * 100;
  };

  return {
    locale, units, tz, currency, imperial, labels,
    number: (n: number | null | undefined) => n0.format(n ?? 0),
    decimal: (n: number | null | undefined) => n1.format(n ?? 0),
    /** 12,345 mi */
    dist: (n: number | null | undefined) => `${n0.format(n ?? 0)} ${labels.distance}`,
    /** 1,315.6 gal */
    vol: (n: number | null | undefined) => `${n1.format(n ?? 0)} ${labels.volume}`,
    weight: (n: number | null | undefined) => `${n0.format(n ?? 0)} ${labels.weight}`,
    speed: (n: number | null | undefined) => `${n0.format(n ?? 0)} ${labels.speed}`,
    /** MPG (imperial) or L/100 km (metric) from a distance and a volume in the company's units. */
    economy,
    economyText: (value: number | null | undefined) => (value == null ? "—" : `${n1.format(value)} ${labels.economy}`),
    money: (n: number | null | undefined) => c0.format(n ?? 0),
    money2: (n: number | null | undefined) => c2.format(n ?? 0),
    /** Fuel prices: $5.777 */
    money3: (n: number | null | undefined) => c3.format(n ?? 0),
    /** Oct 21, 2026 · 21 Oct 2026 */
    date: (d: When) => { const x = toDate(d); return x ? fDate.format(x) : "—"; },
    /** Oct 21 · 21 Oct */
    day: (d: When) => { const x = toDate(d); return x ? fDay.format(x) : "—"; },
    /** Wed, Oct 21 */
    weekday: (d: When) => { const x = toDate(d); return x ? fWeekday.format(x) : "—"; },
    /** Oct 21, 9:32 AM · 21 Oct, 09:32 */
    dateTime: (d: When) => { const x = toDate(d); return x ? fDateTime.format(x) : "—"; },
    time: (d: When) => { const x = toDate(d); return x ? fTime.format(x) : "—"; },
    /** EDT, CST, GMT+5 … */
    zone: (d: When = new Date()) => fZone.formatToParts(toDate(d) ?? new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz,
    /** Value for <input type="date"> in company time. */
    dateInput: (d: When) => { const x = toDate(d); return x ? dayKey(x, tz) : ""; },
    /** Value for <input type="datetime-local"> in company time. */
    dateTimeInput: (d: When) => {
      const x = toDate(d);
      if (!x) return "";
      const p = zonedParts(x, tz);
      return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
    },
    parseDate: (v: string) => parseDateInput(v, tz),
    parseDateTime: (v: string) => parseDateTimeInput(v, tz),
    startOfDay: (d: Date = new Date()) => startOfDayIn(d, tz),
    weekStart: (d: Date = new Date()) => weekStartIn(d, locale),
  };
}
