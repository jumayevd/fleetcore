import { TIMEZONE } from "@/lib/constants";

/*
 * Stop windows are edited as company wall-clock time (TIMEZONE) and travel between the form and the server as ISO
 * instants. Formatting with a fixed zone gives the same string during SSR and in the browser (no hydration
 * mismatch), and the server never has to guess which zone a "yyyy-MM-ddTHH:mm" string meant.
 * Client-safe: no server-only imports.
 */

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Parts = { y: number; mo: number; d: number; h: number; mi: number };

function zonedParts(t: Date): Parts {
  const p: Record<string, string> = {};
  for (const x of PARTS.formatToParts(t)) p[x.type] = x.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const valid = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t;
};

/** Zone offset (ms) at instant `t`: wall clock in TIMEZONE minus UTC. */
function offsetAt(t: number) {
  const p = zonedParts(new Date(t));
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(t / 60_000) * 60_000;
}

/** ISO instant → "yyyy-MM-ddTHH:mm" in company time, for `<input type="datetime-local">`. */
export function toZonedInput(v: Date | string | null | undefined): string {
  const t = valid(v);
  if (!t) return "";
  const p = zonedParts(t);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** "yyyy-MM-ddTHH:mm" in company time → ISO instant ("" when the value is empty or malformed). */
export function fromZonedInput(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return "";
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first)).toISOString(); // second pass settles DST edges
}

/** Instant for `hh:mm` company time, `days` days after today (company calendar). */
export function zonedAt(days: number, hh: number, mm = 0, now = new Date()): Date {
  const p = zonedParts(now);
  const day = new Date(Date.UTC(p.y, p.mo - 1, p.d + days));
  return new Date(fromZonedInput(`${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(hh)}:${pad(mm)}`));
}

/** "02 Oct, 08:00" in company time. */
export function zonedDateTime(v: Date | string | null | undefined): string {
  const t = valid(v);
  if (!t) return "—";
  const p = zonedParts(t);
  return `${pad(p.d)} ${MONTHS[p.mo - 1]}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** "08:00" in company time. */
export function zonedTime(v: Date | string | null | undefined): string {
  const t = valid(v);
  if (!t) return "—";
  const p = zonedParts(t);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** Same calendar day in company time. */
export function sameZonedDay(a: Date | string, b: Date | string) {
  return toZonedInput(a).slice(0, 10) === toZonedInput(b).slice(0, 10);
}

/** Short zone label for hints, e.g. "Tashkent time". */
export const ZONE_LABEL = `${TIMEZONE.split("/").pop()?.replace(/_/g, " ")} time`;
