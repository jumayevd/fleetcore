import type { Prisma } from "@prisma/client";
import type { Tone } from "@/components/ui";
import { daysUntil } from "@/lib/format";

/* Pure helpers shared by the drivers list, detail page and client controls (safe on client and server). */

export const EMPLOYMENT_LABELS: Record<string, string> = { ACTIVE: "Active", ON_LEAVE: "On leave", INACTIVE: "Inactive" };
export const DRIVER_TYPE_TONE: Record<string, Tone> = { COMPANY: "neutral", OWNER_OPERATOR: "progress", LEASE: "info" };

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

export const AT_RISK_SCORE = 75;
export const EXPIRY_SOON_DAYS = 30;

export type RiskInput = { score: number; licenseExpiry: Date | string; medicalExpiry: Date | string | null };
export type Risk = { tone: Tone; text: string; kind: "licence" | "medical" | "score" };

/** Why a driver counts as "at risk": score under 75, or licence / medical expired or expiring within 30 days. Empty = fine. */
export function riskReasons(d: RiskInput): Risk[] {
  const out: Risk[] = [];
  const lic = daysUntil(d.licenseExpiry);
  if (lic != null && lic < 0) out.push({ kind: "licence", tone: "danger", text: `Driving licence expired ${-lic}d ago` });
  else if (lic != null && lic <= EXPIRY_SOON_DAYS) out.push({ kind: "licence", tone: "warn", text: `Driving licence expires in ${lic}d` });
  const med = daysUntil(d.medicalExpiry);
  if (med != null && med < 0) out.push({ kind: "medical", tone: "danger", text: `Medical certificate expired ${-med}d ago` });
  else if (med != null && med <= EXPIRY_SOON_DAYS) out.push({ kind: "medical", tone: "warn", text: `Medical certificate expires in ${med}d` });
  if (d.score < AT_RISK_SCORE) out.push({ kind: "score", tone: d.score < 70 ? "danger" : "warn", text: `Safety score ${d.score} is below ${AT_RISK_SCORE}` });
  return out;
}
export const atRisk = (d: RiskInput) => riskReasons(d).length > 0;

/*
 * riskReasons() / clearance() as database filters, for counts and the roster query. They follow daysUntil(), which
 * rounds up: daysUntil(x) <= 30 ⇔ x <= now + 30 days, and daysUntil(x) < 0 ⇔ x <= now − 1 day (a paper that expires
 * today still counts for today).
 */
const DAY = 86_400_000;
const expiryCutoff = (now: number) => new Date(now + EXPIRY_SOON_DAYS * DAY);
const expiredCutoff = (now: number) => new Date(now - DAY);
/** Licence or medical expired or expiring within 30 days. */
export const expiringWhere = (now = Date.now()): Prisma.DriverWhereInput =>
  ({ OR: [{ licenseExpiry: { lte: expiryCutoff(now) } }, { medicalExpiry: { lte: expiryCutoff(now) } }] });
/** Licence or medical already expired. */
export const expiredWhere = (now = Date.now()): Prisma.DriverWhereInput =>
  ({ OR: [{ licenseExpiry: { lte: expiredCutoff(now) } }, { medicalExpiry: { lte: expiredCutoff(now) } }] });
export const atRiskWhere = (now = Date.now()): Prisma.DriverWhereInput =>
  ({ OR: [{ score: { lt: AT_RISK_SCORE } }, { licenseExpiry: { lte: expiryCutoff(now) } }, { medicalExpiry: { lte: expiryCutoff(now) } }] });
/** Cleared to drive (see clearance()). */
export const clearedWhere = (now = Date.now()): Prisma.DriverWhereInput => ({
  status: "ACTIVE", hold: false, licenseExpiry: { gt: expiredCutoff(now) },
  OR: [{ medicalExpiry: null }, { medicalExpiry: { gt: expiredCutoff(now) } }],
});

/* ------------------------------------------------------------------ */
/* Cleared to drive                                                    */
/* ------------------------------------------------------------------ */

export type ClearanceInput = Omit<RiskInput, "score"> & { status: string; hold: boolean; holdReason: string | null };
export type Clearance = {
  cleared: boolean;
  /** Headline: "Cleared", or the most important blocker ("Inactive", "On leave", "Papers expired", "On hold"). */
  label: string;
  tone: Tone;
  /** One line under the headline: the hold reason, which paper expired, and any other blockers. Empty when cleared. */
  detail: string;
  /** Every blocker as a sentence. Empty when cleared. */
  reasons: string[];
};

/**
 * Whether a driver may drive today: employed and active, not on hold, licence and medical certificate in date.
 * A soon-expiring paper or a low score does not block (those make the driver "at risk" instead).
 */
export function clearance(d: ClearanceInput): Clearance {
  const blockers: { label: string; tone: Tone; text: string; detail?: string }[] = [];
  if (d.status === "INACTIVE") blockers.push({ label: "Inactive", tone: "neutral", text: "No longer works here" });
  if (d.status === "ON_LEAVE") blockers.push({ label: "On leave", tone: "warn", text: "On leave" });
  const lic = daysUntil(d.licenseExpiry);
  const med = daysUntil(d.medicalExpiry);
  const expired = [lic != null && lic < 0 && "Driving licence", med != null && med < 0 && "Medical certificate"].filter(Boolean) as string[];
  if (expired.length) {
    const text = expired.length === 2 ? "Licence and medical certificate expired" : `${expired[0]} expired`;
    blockers.push({ label: "Papers expired", tone: "danger", text, detail: text });
  }
  if (d.hold) blockers.push({ label: "On hold", tone: "warn", text: d.holdReason ? `On hold: ${d.holdReason}` : "On hold", detail: d.holdReason ?? undefined });

  const [head, ...rest] = blockers;
  if (!head) return { cleared: true, label: "Cleared", tone: "ok", detail: "", reasons: [] };
  return {
    cleared: false, label: head.label, tone: head.tone,
    detail: [head.detail, ...rest.map((b) => b.text)].filter(Boolean).join(" · "),
    reasons: blockers.map((b) => b.text),
  };
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/** Years and months since a date: "3 y 2 mo", "7 mo", "new". */
export function tenure(d: Date | string) {
  const months = Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 86_400_000));
  if (months < 1) return "new";
  const y = Math.floor(months / 12);
  const mo = months % 12;
  if (!y) return `${mo} mo`;
  return mo ? `${y} y ${mo} mo` : `${y} y`;
}
