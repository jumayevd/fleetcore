import type { Prisma } from "@prisma/client";
import type { Tone } from "@/components/ui";
import { daysUntil } from "@/lib/format";

/* Pure helpers shared by the drivers list, detail page and client controls (safe on client and server). */

/** Board statuses that mean the driver is working a load right now. */
export const ON_TRIP_STATUSES = ["DISPATCHED", "AT_PICKUP", "EN_ROUTE", "UNLOADING"] as const;
export const COMPLETED_LOAD_STATUSES = ["DELIVERED", "INVOICED"] as const;
export const ACTIVE_LOAD_STATUSES = ["ASSIGNED", "IN_TRANSIT"] as const;

export const EMPLOYMENT_LABELS: Record<string, string> = { ACTIVE: "Active", ON_LEAVE: "On leave", INACTIVE: "Inactive" };
export const DRIVER_TYPE_TONE: Record<string, Tone> = { COMPANY: "neutral", OWNER_OPERATOR: "progress", LEASE: "info" };

export type TeamOption = { id: string; name: string; color: string | null };

/* ------------------------------------------------------------------ */
/* Score & risk                                                        */
/* ------------------------------------------------------------------ */

export type Grade = "A" | "B" | "C" | "D";

/** A ≥ 90 · B ≥ 80 · C ≥ 70 · D below. */
export function scoreGrade(score: number): { grade: Grade; tone: Tone } {
  if (score >= 90) return { grade: "A", tone: "ok" };
  if (score >= 80) return { grade: "B", tone: "info" };
  if (score >= 70) return { grade: "C", tone: "warn" };
  return { grade: "D", tone: "danger" };
}

const AT_RISK_SCORE = 75;
const EXPIRY_SOON_DAYS = 30;

export type RiskInput = { score: number; licenseExpiry: Date | string; medicalExpiry: Date | string | null };
export type Risk = { tone: Tone; text: string };

/** Why a driver counts as "at risk": score under 75, or licence / medical expired or expiring within 30 days. Empty = fine. */
export function riskReasons(d: RiskInput): Risk[] {
  const out: Risk[] = [];
  const lic = daysUntil(d.licenseExpiry);
  if (lic != null && lic < 0) out.push({ tone: "danger", text: `Driving licence expired ${-lic}d ago` });
  else if (lic != null && lic <= EXPIRY_SOON_DAYS) out.push({ tone: "warn", text: `Driving licence expires in ${lic}d` });
  const med = daysUntil(d.medicalExpiry);
  if (med != null && med < 0) out.push({ tone: "danger", text: `Medical certificate expired ${-med}d ago` });
  else if (med != null && med <= EXPIRY_SOON_DAYS) out.push({ tone: "warn", text: `Medical certificate expires in ${med}d` });
  if (d.score < AT_RISK_SCORE) out.push({ tone: d.score < 70 ? "danger" : "warn", text: `Score ${d.score} is below ${AT_RISK_SCORE}` });
  return out;
}
export const atRisk = (d: RiskInput) => riskReasons(d).length > 0;

/** riskReasons() as database filters, for counts and the roster query. daysUntil(x) <= 30 ⇔ x <= now + 30 days. */
const expiryCutoff = (now: number) => new Date(now + EXPIRY_SOON_DAYS * 86_400_000);
export const expiringWhere = (now = Date.now()): Prisma.DriverWhereInput =>
  ({ OR: [{ licenseExpiry: { lte: expiryCutoff(now) } }, { medicalExpiry: { lte: expiryCutoff(now) } }] });
export const atRiskWhere = (now = Date.now()): Prisma.DriverWhereInput =>
  ({ OR: [{ score: { lt: AT_RISK_SCORE } }, { licenseExpiry: { lte: expiryCutoff(now) } }, { medicalExpiry: { lte: expiryCutoff(now) } }] });

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/** Compact age: 12m · 5h · 3d · 2mo (status timers). */
export function sinceShort(d: Date | string | null | undefined) {
  if (!d) return "—";
  const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 60) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

/** "45 min", "3 h 10 min", "2 d 4 h" — time spent in a status. */
export function fmtDuration(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Years and months since a date: "3 y 2 mo", "7 mo", "new". */
export function tenure(d: Date | string) {
  const months = Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 86_400_000));
  if (months < 1) return "new";
  const y = Math.floor(months / 12);
  const mo = months % 12;
  if (!y) return `${mo} mo`;
  return mo ? `${y} y ${mo} mo` : `${y} y`;
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export type DoneLoad = { rate: number; driverPay: number; distanceKm: number; emptyKm: number; deliveredAt: Date | null; deliveryAt: Date };
export type PerfTotals = { loads: number; km: number; emptyKm: number; revenue: number; pay: number; onTime: number };

/** Derived figures from summed totals (e.g. a load aggregate). Same shape as performance(). */
export function perfFromTotals(t: PerfTotals) {
  const { loads: n, km, emptyKm, revenue, onTime } = t;
  return {
    ...t,
    onTimePct: n ? Math.round((onTime / n) * 100) : null,
    avgRevenue: n ? revenue / n : null,
    revPerKm: km ? revenue / km : null,
    emptyPct: km + emptyKm ? Math.round((emptyKm / (km + emptyKm)) * 100) : null,
  };
}

export function performance(loads: DoneLoad[]) {
  return perfFromTotals({
    loads: loads.length,
    km: loads.reduce((a, l) => a + l.distanceKm, 0),
    emptyKm: loads.reduce((a, l) => a + l.emptyKm, 0),
    revenue: loads.reduce((a, l) => a + l.rate, 0),
    pay: loads.reduce((a, l) => a + l.driverPay, 0),
    onTime: loads.filter((l) => l.deliveredAt && l.deliveredAt <= l.deliveryAt).length,
  });
}

export const onTimeTone = (pct: number | null): Tone => (pct == null ? "neutral" : pct >= 95 ? "ok" : pct >= 85 ? "warn" : "danger");
