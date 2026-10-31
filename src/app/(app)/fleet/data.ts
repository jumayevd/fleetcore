import "server-only";
import { db } from "@/lib/db";
import { UNIT_DOC_SLOTS } from "@/lib/documents";
import { isUrgentDefect, OPEN_REPAIR_STATUSES } from "./lib";

/* Queries shared by the truck and trailer lists and pages (always inside the active company). */

export type UnitKind = "truck" | "trailer";
const key = (unit: UnitKind) => (unit === "truck" ? "truckId" : "trailerId");

/** Truck types for pickers: name and oil interval (company distance unit). */
export function truckTypeOptions() {
  return db.truckType.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, oilIntervalKm: true } });
}

export type DefectTally = { open: number; urgent: number; holds: boolean };

/** Open (not closed) defects per unit: how many, how many need a decision today, and whether one keeps the unit off the road. */
export async function openDefects(unit: UnitKind, ids?: string[]) {
  const k = key(unit);
  const rows = await db.defect.findMany({
    where: { status: { not: "CLOSED" }, ...(ids ? { [k]: { in: ids } } : { [k]: { not: null } }) },
    select: { truckId: true, trailerId: true, status: true, severity: true, dueAt: true, holdsUnit: true },
  });
  const now = new Date();
  const out = new Map<string, DefectTally>();
  for (const d of rows) {
    const id = unit === "truck" ? d.truckId : d.trailerId;
    if (!id) continue;
    const t = out.get(id) ?? { open: 0, urgent: 0, holds: false };
    t.open++;
    if (isUrgentDefect(d, now)) t.urgent++;
    if (d.holdsUnit) t.holds = true;
    out.set(id, t);
  }
  return out;
}

/** Who recorded each inactive truck's status: the latest status change in the audit log, per truck. */
export async function statusRecorders(truckIds: string[]) {
  if (!truckIds.length) return new Map<string, string>();
  const rows = await db.auditLog.findMany({
    where: { entity: "truck", action: "status", entityId: { in: truckIds } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, user: { select: { name: true } } },
  });
  const out = new Map<string, string>();
  for (const r of rows) if (r.entityId && r.user && !out.has(r.entityId)) out.set(r.entityId, r.user.name);
  return out;
}

export type OpenRepair = {
  id: string; number: number; title: string; status: string; stage: string | null; stageAt: Date | null;
  scheduledAt: Date; promisedAt: Date | null; inAt: Date | null; repairType: string;
  /** Open repair orders on the unit, this one included. */
  count: number;
};

/** The repair order that matters most per unit: the one in the shop (furthest stage first), else the next scheduled. */
export async function openRepairs(unit: UnitKind, ids?: string[]) {
  const k = key(unit);
  const rows = await db.workOrder.findMany({
    where: { status: { in: OPEN_REPAIR_STATUSES }, voidedAt: null, ...(ids ? { [k]: { in: ids } } : { [k]: { not: null } }) },
    orderBy: [{ scheduledAt: "asc" }],
    select: {
      id: true, number: true, title: true, status: true, stage: true, stageAt: true, scheduledAt: true, promisedAt: true, inAt: true,
      repairType: true, truckId: true, trailerId: true,
    },
  });
  const rank = (s: string) => (s === "IN_PROGRESS" ? 0 : s === "OPEN" ? 1 : 2);
  const out = new Map<string, OpenRepair>();
  for (const w of rows) {
    const id = unit === "truck" ? w.truckId : w.trailerId;
    if (!id) continue;
    const cur = out.get(id);
    const row: OpenRepair = { ...w, count: (cur?.count ?? 0) + 1 };
    if (!cur || rank(w.status) < rank(cur.status)) out.set(id, row);
    else cur.count = row.count;
  }
  return out;
}

/** Slot documents of units, newest first (kind, expiry, issued), for paperwork status in lists. */
export function unitDocRows(unit: UnitKind, ids?: string[]) {
  const k = key(unit);
  return db.document.findMany({
    where: { kind: { in: [...UNIT_DOC_SLOTS[unit]] }, ...(ids ? { [k]: { in: ids } } : { [k]: { not: null } }) },
    orderBy: { createdAt: "desc" },
    select: { truckId: true, trailerId: true, kind: true, expiresAt: true },
  });
}
