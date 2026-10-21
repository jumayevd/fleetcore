import "server-only";
import type { Prisma } from "@prisma/client";
import { format, startOfMonth, subMonths } from "date-fns";
import { db } from "@/lib/db";
import { CLAIM_FAULTS, CLAIM_OPEN_STATUSES, CLAIM_SEVERITIES, CLAIM_STATUSES, CLAIM_TYPES } from "@/lib/constants";
import { daysAgo } from "@/lib/format";
import { CLAIM_CLOSING_STATUSES, CLAIM_TABS, STATUS_GROUPS, SEVERITY_RANK, claimPhase, daysOpen, type ClaimFilters, type ClaimPhase, type ClaimTab } from "./shared";

/* URL-driven filters shared by the table and the analytics tab. */

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const oneOf = (list: readonly string[], v: string | undefined) => (v && list.includes(v) ? v : undefined);

export function parseClaimFilters(sp: Record<string, string | string[] | undefined>): ClaimFilters {
  const tab = str(sp.tab);
  return {
    tab: (tab && (CLAIM_TABS as readonly string[]).includes(tab) ? tab : "table") as ClaimTab,
    type: oneOf(CLAIM_TYPES, str(sp.type)),
    status: oneOf([...CLAIM_STATUSES, ...STATUS_GROUPS], str(sp.status)),
    severity: oneOf(CLAIM_SEVERITIES, str(sp.severity)),
    fault: oneOf(CLAIM_FAULTS, str(sp.fault)),
    q: str(sp.q) ?? "",
  };
}

const OPEN: string[] = [...CLAIM_OPEN_STATUSES];
const CLOSED: string[] = [...CLAIM_CLOSING_STATUSES];

/**
 * Prisma `where` for the filters. `withStatus: false` leaves the status out (for the pill counts).
 * "closed" is paid, closed or denied — approved claims awaiting payment are in neither group (they
 * have their own pill, `status=APPROVED`).
 */
export function claimWhere(f: ClaimFilters, opts: { withStatus?: boolean } = {}): Prisma.ClaimWhereInput {
  const and: Prisma.ClaimWhereInput[] = [];
  if ((opts.withStatus ?? true) && f.status) {
    if (f.status === "open") and.push({ status: { in: OPEN } });
    else if (f.status === "closed") and.push({ status: { in: CLOSED } });
    else and.push({ status: f.status });
  }
  if (f.type) and.push({ type: f.type });
  if (f.severity) and.push({ severity: f.severity });
  if (f.fault) and.push({ fault: f.fault });
  if (f.q) {
    const like = { contains: f.q, mode: "insensitive" as const };
    and.push({ OR: [
      { number: like }, { description: like }, { location: like },
      { load: { reference: like } }, { driver: { name: like } }, { truck: { unitNumber: like } }, { trailer: { unitNumber: like } },
      { customer: { name: like } }, { assignedTo: { name: like } },
    ] });
  }
  return and.length ? { AND: and } : {};
}

/** Columns the table needs. */
export const LIST_INCLUDE = {
  driver: { select: { id: true, name: true } },
  load: { select: { id: true, reference: true } },
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  customer: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  _count: { select: { documents: true, notes: true } },
} satisfies Prisma.ClaimInclude;

export type ListClaim = Prisma.ClaimGetPayload<{ include: typeof LIST_INCLUDE }>;

const PHASE_RANK: Record<ClaimPhase, number> = { open: 0, awaiting: 1, closed: 2 };

/**
 * Open claims first — most severe, then oldest — then approved claims awaiting payment (same order),
 * then closed claims, most recently closed first.
 */
export function sortForTable<T extends { status: string; severity: string; createdAt: Date; closedAt: Date | null }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const pa = claimPhase(a.status), pb = claimPhase(b.status);
    if (pa !== pb) return PHASE_RANK[pa] - PHASE_RANK[pb];
    if (pa !== "closed") {
      const s = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (s) return s;
      return a.createdAt.getTime() - b.createdAt.getTime();
    }
    return (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0);
  });
}

/* ------------------------------------------------------------------ */
/* KPIs (fleet-wide, not affected by the filters)                      */
/* ------------------------------------------------------------------ */

export async function claimKpis() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const since = daysAgo(365);
  const [open, settledYtd, closedRecent, claims12, loads12] = await Promise.all([
    db.claim.findMany({ where: { status: { in: OPEN } }, select: { severity: true, status: true, amountClaimed: true, createdAt: true, closedAt: true } }),
    db.claim.findMany({ where: { amountSettled: { not: null }, closedAt: { gte: yearStart } }, select: { amountClaimed: true, amountSettled: true } }),
    db.claim.findMany({ where: { closedAt: { gte: since } }, select: { createdAt: true, closedAt: true } }),
    db.claim.count({ where: { createdAt: { gte: since } } }),
    db.load.count({ where: { status: { not: "CANCELLED" }, pickupAt: { gte: since, lte: now } } }),
  ]);
  const ages = open.map((c) => daysOpen(c));
  const severe = open.filter((c) => c.severity === "HIGH" || c.severity === "CRITICAL").length;
  const contested = open.filter((c) => c.status === "NEGOTIATION" || c.status === "DISPUTED" || c.status === "LITIGATION");
  // Denials are written with amountSettled = 0: they stay in the recovery rate (claimed, nothing back)
  // but are not counted as settlements.
  const settled = settledYtd.reduce((a, c) => a + (c.amountSettled ?? 0), 0);
  const settledClaimed = settledYtd.reduce((a, c) => a + c.amountClaimed, 0);
  const paidYtd = settledYtd.filter((c) => (c.amountSettled ?? 0) > 0).length;
  const closeDays = closedRecent.map((c) => daysOpen(c)).sort((a, b) => a - b);
  const avgClose = closeDays.length ? Math.round(closeDays.reduce((a, b) => a + b, 0) / closeDays.length) : null;
  const medianClose = closeDays.length ? closeDays[Math.floor(closeDays.length / 2)] : null;
  return {
    openCount: open.length,
    severeOpen: severe,
    oldestOpen: ages.length ? Math.max(...ages) : 0,
    openClaimed: open.reduce((a, c) => a + c.amountClaimed, 0),
    contestedCount: contested.length,
    contestedClaimed: contested.reduce((a, c) => a + c.amountClaimed, 0),
    settledYtd: settled,
    /** Closed this year with money received. */
    settledYtdCount: paidYtd,
    /** Closed this year with nothing recovered (denials). */
    unrecoveredYtdCount: settledYtd.length - paidYtd,
    recoveryYtdPct: settledClaimed ? Math.round((settled / settledClaimed) * 100) : null,
    avgClose, medianClose, closedCount: closedRecent.length,
    claims12, loads12,
    per100Loads: loads12 ? Math.round((claims12 / loads12) * 1000) / 10 : null,
  };
}

/* ------------------------------------------------------------------ */
/* Analytics (honours the filters)                                     */
/* ------------------------------------------------------------------ */

export async function claimAnalytics(where: Prisma.ClaimWhereInput) {
  const months = 12;
  const from = startOfMonth(subMonths(new Date(), months - 1));
  const claims = await db.claim.findMany({
    where,
    select: {
      id: true, type: true, status: true, severity: true, fault: true, amountClaimed: true, amountSettled: true, createdAt: true, closedAt: true,
      driverId: true, driver: { select: { id: true, name: true } },
    },
  });

  const byType = CLAIM_TYPES.map((type) => {
    const xs = claims.filter((c) => c.type === type);
    return { type, count: xs.length, claimed: xs.reduce((a, c) => a + c.amountClaimed, 0), settled: xs.reduce((a, c) => a + (c.amountSettled ?? 0), 0) };
  }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count || b.claimed - a.claimed);

  const funnel = CLAIM_STATUSES.map((status) => ({ status, count: claims.filter((c) => c.status === status).length }));

  const buckets = new Map<string, { month: string; opened: number; closed: number }>();
  for (let i = 0; i < months; i++) {
    const m = format(subMonths(new Date(), months - 1 - i), "MMM yy");
    buckets.set(m, { month: m, opened: 0, closed: 0 });
  }
  for (const c of claims) {
    if (c.createdAt >= from) { const b = buckets.get(format(c.createdAt, "MMM yy")); if (b) b.opened += 1; }
    if (c.closedAt && c.closedAt >= from) { const b = buckets.get(format(c.closedAt, "MMM yy")); if (b) b.closed += 1; }
  }
  const monthly = [...buckets.values()];

  const faults = CLAIM_FAULTS.map((fault) => ({ fault, count: claims.filter((c) => c.fault === fault).length })).filter((f) => f.count > 0);

  const driverIds = [...new Set(claims.map((c) => c.driverId).filter(Boolean) as string[])];
  const loadsByDriver = driverIds.length
    ? await db.load.groupBy({ by: ["driverId"], where: { driverId: { in: driverIds }, status: { not: "CANCELLED" }, pickupAt: { gte: daysAgo(365) } }, _count: true })
    : [];
  const loadCount = new Map(loadsByDriver.map((r) => [r.driverId, r._count]));
  const drivers = driverIds.map((id) => {
    const xs = claims.filter((c) => c.driverId === id);
    const loads = loadCount.get(id) ?? 0;
    return {
      id, name: xs[0].driver?.name ?? "Unknown driver",
      claims: xs.length,
      open: xs.filter((c) => OPEN.includes(c.status)).length,
      ours: xs.filter((c) => c.fault === "OURS").length,
      claimed: xs.reduce((a, c) => a + c.amountClaimed, 0),
      settled: xs.reduce((a, c) => a + (c.amountSettled ?? 0), 0),
      loads,
      per100: loads ? Math.round((xs.length / loads) * 1000) / 10 : null,
    };
  }).sort((a, b) => b.claims - a.claims || b.claimed - a.claimed).slice(0, 10);

  return { total: claims.length, byType, funnel, monthly, faults, drivers };
}
