import "server-only";
import type { Trailer, Truck } from "@prisma/client";
import { db } from "@/lib/db";
import { REQUIRED_UNIT_DOCS } from "@/lib/documents";
import { EQUIPMENT_LABELS } from "@/lib/constants";
import { daysUntil } from "@/lib/format";
import type { Tone } from "@/components/ui";
import { unitComplianceHref } from "./links";

const DAY = 86_400_000;

// Period selector: trailing windows so period-over-period is fair (shared with Reports).
export { PERIODS, parsePeriod, periodRange, type PeriodKey } from "./period";

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export const TABS = ["summary", "log", "pm", "lease", "shop", "compliance"] as const;
export type TabKey = (typeof TABS)[number];
export const TAB_LABELS: Record<TabKey, string> = {
  summary: "Summary", log: "Repair log", pm: "PM schedule", lease: "Lease mileage", shop: "In shop", compliance: "Compliance",
};
export function parseTab(v: unknown): TabKey {
  return typeof v === "string" && (TABS as readonly string[]).includes(v) ? (v as TabKey) : "summary";
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Whole days from `from` to `to` (never negative). */
export const daysBetween = (from: Date | null | undefined, to: Date = new Date()) =>
  from ? Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY)) : 0;

/** Days in the shop → tone: quiet until a week, caution to three weeks, then a problem. */
export const shopTone = (days: number): Tone => (days > 21 ? "danger" : days > 7 ? "warn" : "neutral");

/** First non-empty string from a searchParams value. */
export const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function fleetUnits() {
  const [trucks, trailers] = await Promise.all([
    db.truck.findMany({ orderBy: { unitNumber: "asc" } }),
    db.trailer.findMany({ orderBy: { unitNumber: "asc" } }),
  ]);
  return { trucks, trailers };
}

/** Distinct units across work orders: two jobs on one truck count as one unit. */
export const countUnits = (rows: { truckId: string | null; trailerId: string | null }[]) =>
  new Set(rows.map((r) => r.truckId ?? r.trailerId).filter(Boolean)).size;

/** Units with a job in progress (not the number of jobs). */
export async function unitsInShopCount() {
  const rows = await db.workOrder.groupBy({ by: ["truckId", "trailerId"], where: { status: "IN_PROGRESS" } });
  return countUnits(rows);
}

/** Pickers for the work order form: units with a one-line description, plus known vendors for autocomplete. */
export async function workOrderFormOptions() {
  const [trucks, trailers, vendors] = await Promise.all([
    db.truck.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, make: true, model: true, odometerKm: true, lastPmKm: true, status: true } }),
    db.trailer.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, type: true, status: true } }),
    db.workOrder.findMany({ where: { vendor: { not: null } }, distinct: ["vendor"], select: { vendor: true }, orderBy: { vendor: "asc" } }),
  ]);
  return {
    trucks: trucks.map((t) => ({
      id: t.id, unitNumber: t.unitNumber, odometerKm: t.odometerKm, lastPmKm: t.lastPmKm,
      detail: `${t.make} ${t.model}${t.status !== "ACTIVE" ? ` · ${t.status.toLowerCase().replace(/_/g, " ")}` : ""}`,
    })),
    trailers: trailers.map((t) => ({
      id: t.id, unitNumber: t.unitNumber,
      detail: `${EQUIPMENT_LABELS[t.type] ?? t.type}${t.status !== "EMPTY" && t.status !== "YARD" ? ` · ${t.status.toLowerCase().replace(/_/g, " ")}` : ""}`,
    })),
    vendors: vendors.map((v) => v.vendor!).filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/* PM schedule                                                         */
/* ------------------------------------------------------------------ */

export type OpenPm = { id: string; number: number; status: string; truckId: string | null };
/** The truck's most recent completed PM work order: what it cost and where it was done. */
export type LastPmJob = { id: string; number: number; cost: number; vendor: string | null; completedAt: Date | null; truckId: string | null };
export type PmRow = {
  truck: Truck;
  /** Odometer reading the next PM is due at (explicit, else last PM + interval). */
  nextService: number | null;
  /** Negative = overdue. */
  kmLeft: number | null;
  /** Share of the interval already driven (can exceed 1). */
  used: number | null;
  openPm: OpenPm | null;
  lastJob: LastPmJob | null;
};

type PmFields = Pick<Truck, "nextServiceKm" | "lastPmKm" | "pmIntervalKm">;
/** Odometer reading the next PM is due at: the explicit reading, else last PM + interval (same rule as the alerts). */
export const pmNextService = (t: PmFields) => t.nextServiceKm ?? (t.lastPmKm != null ? t.lastPmKm + t.pmIntervalKm : null);

export function pmRows(trucks: Truck[], openPm: OpenPm[], lastPm: Map<string, LastPmJob> = new Map()): PmRow[] {
  return trucks
    .filter((t) => t.status !== "INACTIVE")
    .map((t) => {
      const nextService = pmNextService(t);
      const kmLeft = nextService != null ? nextService - t.odometerKm : null;
      const used = t.pmIntervalKm > 0 && kmLeft != null ? (t.pmIntervalKm - kmLeft) / t.pmIntervalKm : null;
      return { truck: t, nextService, kmLeft, used, openPm: openPm.find((w) => w.truckId === t.id) ?? null, lastJob: lastPm.get(t.id) ?? null };
    })
    .sort((a, b) => (a.kmLeft ?? Infinity) - (b.kmLeft ?? Infinity));
}

/**
 * Latest completed PM work order per truck. Two bounded queries: each truck's latest completion time, then the jobs
 * completed at exactly that time (one per truck in practice; the highest number wins a tie).
 */
export async function lastPmJobs(truckIds: string[]) {
  const byTruck = new Map<string, LastPmJob>();
  if (!truckIds.length) return byTruck;
  const where = { category: "PM", status: "DONE", truckId: { in: truckIds } };
  const latest = await db.workOrder.groupBy({ by: ["truckId"], where: { ...where, completedAt: { not: null } }, _max: { completedAt: true } });
  const pairs = latest.flatMap((l) => (l.truckId && l._max.completedAt ? [{ truckId: l.truckId, completedAt: l._max.completedAt }] : []));
  if (!pairs.length) return byTruck;
  const rows = await db.workOrder.findMany({
    where: { ...where, OR: pairs },
    orderBy: { number: "desc" },
    select: { id: true, number: true, cost: true, vendor: true, completedAt: true, truckId: true },
  });
  for (const r of rows) if (r.truckId && !byTruck.has(r.truckId)) byTruck.set(r.truckId, r);
  return byTruck;
}

export const pmTone = (kmLeft: number | null): Tone =>
  kmLeft == null ? "neutral" : kmLeft < 0 ? "danger" : kmLeft <= 2000 ? "warn" : kmLeft <= 5000 ? "info" : "ok";

export async function openPmWorkOrders(): Promise<OpenPm[]> {
  return db.workOrder.findMany({
    where: { category: "PM", status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } },
    select: { id: true, number: true, status: true, truckId: true },
  });
}

/* ------------------------------------------------------------------ */
/* Lease mileage                                                       */
/* ------------------------------------------------------------------ */

export type LeaseRow = {
  truck: Truck;
  startKm: number;
  limitKm: number;
  bufferPct: number;
  /** start + limit × (1 + buffer). Beyond it every km costs `rate`. */
  cap: number;
  driven: number;
  remaining: number;
  over: number;
  rate: number;
  exposure: number;
  /** Share of the cap consumed (can exceed 1). */
  used: number;
};

export function leaseRows(trucks: Truck[]) {
  const rows: LeaseRow[] = trucks
    .filter((t) => t.ownership === "LEASED" && t.leaseAnnualLimitKm != null)
    .map((t) => {
      const startKm = t.leaseStartKm ?? 0;
      const limitKm = t.leaseAnnualLimitKm ?? 0;
      const bufferPct = t.leaseBufferPct ?? 0;
      const cap = Math.round(startKm + limitKm * (1 + bufferPct / 100));
      const driven = Math.max(0, t.odometerKm - startKm);
      const remaining = cap - t.odometerKm;
      const over = Math.max(0, -remaining);
      const rate = t.leaseOverageRate ?? 0;
      return { truck: t, startKm, limitKm, bufferPct, cap, driven, remaining, over, rate, exposure: over * rate, used: cap > startKm ? driven / (cap - startKm) : 0 };
    })
    .sort((a, b) => a.remaining - b.remaining);
  const totals = rows.reduce(
    (a, r) => ({ driven: a.driven + r.driven, limit: a.limit + r.limitKm, over: a.over + r.over, exposure: a.exposure + r.exposure, overCount: a.overCount + (r.over > 0 ? 1 : 0) }),
    { driven: 0, limit: 0, over: 0, exposure: 0, overCount: 0 },
  );
  return { rows, totals };
}

export const leaseTone = (r: LeaseRow): Tone => (r.over > 0 ? "danger" : r.remaining < 5000 ? "warn" : "ok");

/* ------------------------------------------------------------------ */
/* Unit compliance (REQUIRED_UNIT_DOCS per truck / trailer)            */
/* ------------------------------------------------------------------ */

export type DocState = "expired" | "expiring" | "missing" | "ok";
const DOC_STATE_RANK: Record<DocState, number> = { expired: 0, expiring: 1, missing: 2, ok: 3 };
export const DOC_STATE_TONE: Record<DocState, Tone> = { expired: "danger", expiring: "warn", missing: "info", ok: "ok" };
export const DOC_STATE_LABEL: Record<DocState, string> = { expired: "Expired", expiring: "Expiring", missing: "Missing", ok: "On file" };

export type UnitDoc = {
  kind: string;
  state: DocState;
  expiresAt: Date | null;
  days: number | null;
  /** A file is uploaded. When false the state comes from the date on the unit record. */
  onFile: boolean;
};
export type ComplianceRow = {
  type: "truck" | "trailer";
  id: string;
  unitNumber: string;
  detail: string;
  status: string;
  href: string;
  docs: UnitDoc[];
  worst: DocState;
  /** Smallest days-to-expiry across the unit's documents (for ordering within a state). */
  soonest: number;
};

/** Expiry recorded on the unit itself (the fleet form fields), used when no uploaded file carries one. */
function fieldExpiry(unit: Truck | Trailer, type: "truck" | "trailer", kind: string): Date | null {
  if (kind === "INSURANCE") return unit.insuranceExpiry ?? null;
  if (kind === "INSPECTION") return unit.inspectionExpiry ?? null;
  if (kind === "REGISTRATION" && type === "truck") return (unit as Truck).registrationExpiry ?? null;
  return null;
}

const stateOf = (days: number | null): DocState => (days == null ? "ok" : days < 0 ? "expired" : days <= 30 ? "expiring" : "ok");

export async function unitCompliance(trucks: Truck[], trailers: Trailer[]) {
  const docs = await db.document.findMany({
    where: { OR: [{ truckId: { not: null } }, { trailerId: { not: null } }], kind: { in: [...REQUIRED_UNIT_DOCS] } },
    select: { truckId: true, trailerId: true, kind: true, expiresAt: true },
  });
  // Latest document per unit + kind wins (a re-upload supersedes the old file).
  const latest = new Map<string, Date | null>();
  for (const d of docs) {
    const key = `${d.truckId ? "t" : "r"}:${d.truckId ?? d.trailerId}:${d.kind}`;
    if (!latest.has(key)) { latest.set(key, d.expiresAt); continue; }
    const cur = latest.get(key);
    if (cur === null) continue; // a document without expiry never expires
    if (d.expiresAt === null || (cur && d.expiresAt > cur)) latest.set(key, d.expiresAt);
  }

  const build = (unit: Truck | Trailer, type: "truck" | "trailer", detail: string): ComplianceRow => {
    const prefix = type === "truck" ? "t" : "r";
    const unitDocs: UnitDoc[] = REQUIRED_UNIT_DOCS.map((kind) => {
      const key = `${prefix}:${unit.id}:${kind}`;
      const onFile = latest.has(key);
      const recorded = fieldExpiry(unit, type, kind);
      // Same rule as the unit page: the file's own expiry, else the date recorded on the unit.
      const expiresAt = onFile ? (latest.get(key) ?? recorded) : recorded;
      const days = daysUntil(expiresAt);
      const byDate = stateOf(days);
      // No file on record: an expired or expiring recorded date outranks "missing" because the renewal is the real problem.
      const state: DocState = onFile ? byDate : byDate === "ok" ? "missing" : byDate;
      return { kind, state, expiresAt, days, onFile };
    });
    const worst = unitDocs.reduce<DocState>((w, d) => (DOC_STATE_RANK[d.state] < DOC_STATE_RANK[w] ? d.state : w), "ok");
    const soonest = Math.min(...unitDocs.map((d) => d.days ?? Infinity));
    return { type, id: unit.id, unitNumber: unit.unitNumber, detail, status: unit.status, href: unitComplianceHref(type, unit.id), docs: unitDocs, worst, soonest };
  };

  const rows = [
    ...trucks.filter((t) => t.status !== "INACTIVE").map((t) => build(t, "truck", `${t.make} ${t.model}`)),
    ...trailers.filter((t) => t.status !== "OUT_OF_SERVICE").map((t) => build(t, "trailer", `${(EQUIPMENT_LABELS[t.type] ?? t.type).toLowerCase()} trailer`)),
  ].sort((a, b) => DOC_STATE_RANK[a.worst] - DOC_STATE_RANK[b.worst] || a.soonest - b.soonest || a.unitNumber.localeCompare(b.unitNumber));

  const units: Record<DocState, number> = { expired: 0, expiring: 0, missing: 0, ok: 0 };
  const documents: Record<DocState, number> = { expired: 0, expiring: 0, missing: 0, ok: 0 };
  for (const r of rows) {
    units[r.worst]++;
    for (const d of r.docs) documents[d.state]++;
  }
  return { rows, units, documents, issues: rows.length - units.ok };
}
