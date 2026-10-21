import { can, canOpen } from "@/lib/permissions";
import { dayKey, makeFormat, parseDateInput, type CompanyLocale } from "@/lib/locale";
import { humanize } from "@/lib/constants";

/*
 * What every assistant tool needs to speak the company's language: the formatter (units, time zone, currency), which
 * links the role may open, whether it may see money, and date parsing in company time. No database access here.
 */

const DAY = 86_400_000;

/** Said in place of any cost, invoice or spend for roles without money.view. */
export const COSTS_HIDDEN = "Costs, invoices and spend are not shown to this role. Say so if asked about money.";

export type KitContext = { role: string; locale: CompanyLocale };
export type Kit = ReturnType<typeof makeKit>;
/** Keeps an href only when the role can open it; JSON drops `undefined`, so the key disappears. */
export type Linker = (href: string) => string | undefined;

export function makeKit(ctx: KitContext) {
  const f = makeFormat(ctx.locale);
  const tz = f.tz;
  const seesMoney = can(ctx.role, "money.view");
  const seesDrivers = can(ctx.role, "drivers.view");
  const link: Linker = (href) => (canOpen(ctx.role, href) ? href : undefined);

  /** `o` for roles that see money, nothing otherwise: spread it into a view (`...cash({ cost })`). */
  const cash = <T extends object>(o: T): T | Record<string, never> => (seesMoney ? o : {});
  const date = (d: Date | null | undefined) => (d ? f.date(d) : null);
  /** "Oct 21, 2026, 9:32 AM" / "21 Oct 2026, 09:32" in company time. */
  const dateTime = (d: Date | null | undefined) => (d ? `${f.date(d)}, ${f.time(d)}` : null);

  /** Midnight (company time) of a YYYY-MM-DD day; null when that day does not exist. */
  const parseDay = (ymd: string): Date | null => {
    const d = parseDateInput(ymd, tz);
    return d && dayKey(d, tz) === ymd ? d : null;
  };

  /** Optional inclusive day bounds as a Prisma date filter ({ gte, lt }). */
  function dayBounds(fromYmd: string | undefined, toYmd: string | undefined): { gte?: Date; lt?: Date } | { error: string } {
    const gte = fromYmd ? parseDay(fromYmd) : undefined;
    const end = toYmd ? parseDay(toYmd) : undefined;
    if (gte === null) return { error: `${fromYmd} is not a valid date. Use YYYY-MM-DD.` };
    if (end === null) return { error: `${toYmd} is not a valid date. Use YYYY-MM-DD.` };
    const lt = end ? nextDay(end) : undefined;
    if (gte && lt && gte >= lt) return { error: "The start date must be on or before the end date." };
    return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
  }

  /** Midnight of the next company day (DST-safe). */
  const nextDay = (d: Date) => f.startOfDay(new Date(d.getTime() + DAY + 6 * 3_600_000));

  /** [from, to) from inclusive YYYY-MM-DD days; default the `defaultDays` days up to and including today. */
  function resolvePeriod(fromYmd: string | undefined, toYmd: string | undefined, now: number, defaultDays = 90) {
    const toDay = toYmd ? parseDay(toYmd) : f.startOfDay(new Date(now));
    if (!toDay) return { error: `${toYmd} is not a valid date. Use YYYY-MM-DD.` } as const;
    const to = nextDay(toDay);
    const from = fromYmd ? parseDay(fromYmd) : f.startOfDay(new Date(to.getTime() - defaultDays * DAY + 6 * 3_600_000));
    if (!from) return { error: `${fromYmd} is not a valid date. Use YYYY-MM-DD.` } as const;
    if (from >= to) return { error: "The start date must be on or before the end date." } as const;
    const days = Math.round((to.getTime() - from.getTime()) / DAY);
    if (days > 1100) return { error: "Pick a period of three years or less." } as const;
    return { from, to, days, label: `${f.date(from)} – ${f.date(new Date(to.getTime() - 1))}` };
  }

  /** "12d 9h" from a span in ms. */
  const span = (ms: number) => {
    const h = Math.max(0, Math.floor(ms / 3_600_000));
    return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`;
  };

  const label = (map: Record<string, string>, v: string | null | undefined) => (v ? (map[v] ?? humanize(v)) : null);

  return { f, L: f.labels, tz, seesMoney, seesDrivers, link, cash, date, dateTime, parseDay, dayBounds, nextDay, resolvePeriod, span, label };
}

export const daysUntil = (v: Date | null | undefined, now: number) => (v ? Math.ceil((v.getTime() - now) / DAY) : null);
export const daysSince = (v: Date, now: number) => Math.max(0, Math.floor((now - v.getTime()) / DAY));
export const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;
export const sumOf = <T,>(xs: T[], fn: (x: T) => number) => xs.reduce((a, x) => a + fn(x), 0);
export const DAY_MS = DAY;
