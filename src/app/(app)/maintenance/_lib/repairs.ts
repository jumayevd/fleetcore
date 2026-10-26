import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PAYERS, REPAIR_STAGES, REPAIR_TYPES } from "@/lib/constants";
import type { VendorOption } from "@/components/shop/shared";
import { str } from "./data";

/*
 * Repairs list: the filters in the URL, the Prisma `where` they make, and the counts above the list. The CSV export
 * (src/app/api/export/repairs/route.ts) reads the same filters, so a download is exactly what the page shows.
 */

export const REPAIR_VIEWS = ["active", "scheduled", "shop", "overdue", "completed", "cancelled", "all"] as const;
export type RepairView = (typeof REPAIR_VIEWS)[number];
export const REPAIR_VIEW_LABELS: Record<RepairView, string> = {
  active: "Active", scheduled: "Scheduled", shop: "In the shop", overdue: "Overdue", completed: "Completed", cancelled: "Void", all: "All",
};

/** Older links use work-order statuses (?status=IN_PROGRESS). */
const LEGACY_STATUS: Record<string, RepairView> = { IN_PROGRESS: "shop", DONE: "completed", OPEN: "scheduled", DRAFT: "scheduled", CANCELLED: "cancelled" };

export type RepairFilters = {
  view: RepairView;
  kind?: "truck" | "trailer";
  /** Vendor id, "none" (no shop recorded), or "t:<typed name>" for older orders. */
  shop?: string;
  /** A truck or trailer id. */
  unit?: string;
  type?: string;
  payer?: string;
  q?: string;
  /** "no": only repairs charged to a driver who has not been told. */
  told?: "no";
  /** Where a job in the shop has got to (REPAIR_STAGES). */
  stage?: string;
};

type SP = Record<string, string | string[] | undefined>;

/** Repairs opens on every repair; Active, Completed and the tiles narrow it down. */
export const DEFAULT_REPAIR_VIEW: RepairView = "all";

export function parseRepairFilters(sp: SP): RepairFilters {
  const raw = str(sp.status);
  const view: RepairView = raw && (REPAIR_VIEWS as readonly string[]).includes(raw) ? (raw as RepairView) : raw ? LEGACY_STATUS[raw] ?? DEFAULT_REPAIR_VIEW : DEFAULT_REPAIR_VIEW;
  const kind = str(sp.kind);
  const type = str(sp.type);
  const payer = str(sp.payer);
  const stage = str(sp.stage);
  return {
    stage: stage && (REPAIR_STAGES as readonly string[]).includes(stage) ? stage : undefined,
    view,
    kind: kind === "truck" || kind === "trailer" ? kind : undefined,
    shop: str(sp.shop),
    unit: str(sp.unit),
    type: type && (REPAIR_TYPES as readonly string[]).includes(type) ? type : undefined,
    payer: payer && (PAYERS as readonly string[]).includes(payer) ? payer : undefined,
    q: str(sp.q)?.slice(0, 80),
    told: str(sp.told) === "no" ? "no" : undefined,
  };
}

/** The filters as query parameters (to build links and the export URL). */
export const filterQuery = (f: RepairFilters) => ({
  status: f.view === DEFAULT_REPAIR_VIEW ? undefined : f.view, kind: f.kind, shop: f.shop, unit: f.unit, type: f.type, payer: f.payer, q: f.q, told: f.told, stage: f.stage,
});

const ACTIVE = ["DRAFT", "OPEN", "IN_PROGRESS"];

/** Booked work that never went in, and work in the shop past the date the shop promised. */
export const overdueWhere = (now: Date, todayStart: Date): Prisma.WorkOrderWhereInput => ({
  voidedAt: null,
  OR: [
    { status: "IN_PROGRESS", promisedAt: { lt: now } },
    { status: { in: ["DRAFT", "OPEN"] }, scheduledAt: { lt: todayStart } },
  ],
});

export const notToldWhere: Prisma.WorkOrderWhereInput = { payer: "DRIVER", driverInformedAt: null, voidedAt: null, status: { not: "CANCELLED" } };

export function viewWhere(view: RepairView, now: Date, todayStart: Date): Prisma.WorkOrderWhereInput {
  switch (view) {
    case "active": return { status: { in: ACTIVE }, voidedAt: null };
    case "scheduled": return { status: { in: ["DRAFT", "OPEN"] }, voidedAt: null };
    case "shop": return { status: "IN_PROGRESS", voidedAt: null };
    case "overdue": return overdueWhere(now, todayStart);
    case "completed": return { status: "DONE", voidedAt: null };
    case "cancelled": return { status: "CANCELLED" };
    case "all": return {};
  }
}

function searchWhere(q: string): Prisma.WorkOrderWhereInput {
  const contains = { contains: q, mode: "insensitive" as const };
  const n = /^(?:ro[-\s]?)?#?0*(\d{1,7})$/i.exec(q.trim());
  return {
    OR: [
      { title: contains }, { description: contains }, { vendor: contains }, { invoiceNumber: contains }, { technician: contains },
      { truck: { unitNumber: contains } }, { trailer: { unitNumber: contains } },
      { chargeDriver: { name: contains } }, { truck: { driver: { name: contains } } },
      { lines: { some: { work: contains } } },
      ...(n ? [{ number: Number(n[1]) }] : []),
    ],
  };
}

export function repairWhere(f: RepairFilters, now: Date, todayStart: Date): Prisma.WorkOrderWhereInput {
  const and: Prisma.WorkOrderWhereInput[] = [viewWhere(f.view, now, todayStart)];
  if (f.kind === "truck") and.push({ truckId: { not: null } });
  if (f.kind === "trailer") and.push({ trailerId: { not: null } });
  if (f.unit) and.push({ OR: [{ truckId: f.unit }, { trailerId: f.unit }] });
  if (f.type) and.push({ repairType: f.type });
  if (f.payer) and.push({ payer: f.payer });
  if (f.told) and.push(notToldWhere);
  if (f.stage) and.push({ status: "IN_PROGRESS", stage: f.stage });
  if (f.shop === "none") and.push({ vendorId: null, vendor: null });
  else if (f.shop?.startsWith("t:")) and.push({ vendorId: null, vendor: f.shop.slice(2) });
  else if (f.shop) and.push({ vendorId: f.shop });
  if (f.q) and.push(searchWhere(f.q));
  return { AND: and };
}

const driverPick = { select: { id: true, name: true, phone: true } } as const;

/** What a repairs row shows. */
export const repairRowInclude = {
  truck: { select: { id: true, unitNumber: true, driver: driverPick } },
  trailer: { select: { id: true, unitNumber: true, truck: { select: { unitNumber: true, driver: driverPick } } } },
  vendorRef: { select: { id: true, name: true, phone: true, contactName: true } },
  chargeDriver: { select: { id: true, name: true } },
  lines: { orderBy: { position: "asc" }, select: { system: true, work: true, amount: true } },
} satisfies Prisma.WorkOrderInclude;

export type RepairRow = Prisma.WorkOrderGetPayload<{ include: typeof repairRowInclude }>;

/** Working order: in the shop first (longest in first), then booked (earliest first); finished work newest first. */
export function sortRepairs(rows: RepairRow[], view: RepairView) {
  const rank = (w: RepairRow) => (w.status === "IN_PROGRESS" ? 0 : w.status === "OPEN" || w.status === "DRAFT" ? 1 : w.status === "DONE" ? 2 : 3);
  const when = (w: RepairRow) =>
    w.status === "IN_PROGRESS" ? (w.inAt ?? w.scheduledAt).getTime()
      : w.status === "DONE" ? -(w.completedAt ?? w.updatedAt).getTime()
        : w.status === "CANCELLED" ? -(w.voidedAt ?? w.updatedAt).getTime()
          : w.scheduledAt.getTime();
  if (view === "completed" || view === "cancelled") return [...rows].sort((a, b) => when(a) - when(b));
  return [...rows].sort((a, b) => rank(a) - rank(b) || when(a) - when(b));
}

/** Who is driving the unit: the truck's driver, or for a trailer the driver of the truck it is hooked to. */
export const unitDriver = (w: Pick<RepairRow, "truck" | "trailer">) => w.truck?.driver ?? w.trailer?.truck?.driver ?? null;

/** Tile counts (every repair, not just the filtered ones). */
export async function repairCounts(now: Date, todayStart: Date, monthStart: Date) {
  const [byStatus, overdue, completedMonth, notTold, all] = await Promise.all([
    db.workOrder.groupBy({ by: ["status"], where: { voidedAt: null }, _count: { _all: true } }),
    db.workOrder.count({ where: overdueWhere(now, todayStart) }),
    db.workOrder.count({ where: { status: "DONE", voidedAt: null, completedAt: { gte: monthStart } } }),
    db.workOrder.count({ where: notToldWhere }),
    db.workOrder.count({ where: viewWhere("all", now, todayStart) }),
  ]);
  const of = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  return {
    scheduled: of("DRAFT") + of("OPEN"), shop: of("IN_PROGRESS"), active: of("DRAFT") + of("OPEN") + of("IN_PROGRESS"),
    completed: of("DONE"), completedMonth, overdue, notTold, all,
  };
}

/** Vendors for the picker: active ones and any already used by the order being edited. */
export async function vendorOptions(): Promise<VendorOption[]> {
  return db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true, city: true, phone: true, active: true } });
}
