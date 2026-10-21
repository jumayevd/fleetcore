import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { BOARD_STATUSES, MANUAL_BOARD_STATUSES } from "@/lib/constants";

const DAY = 86_400_000;

/** Board statuses derived from a live load (the driver is out working) versus the hand-set ones that mean off the road. */
const WORKING_STATUSES = BOARD_STATUSES.filter((s) => !MANUAL_BOARD_STATUSES.includes(s));
const OFF_STATUSES = MANUAL_BOARD_STATUSES.filter((s) => s !== "READY");

/** Pickups due within 24 h (and any already overdue), soonest first, plus the total so the card can say "+N more". */
export async function upcomingPickups(now: Date, take = 8) {
  const where: Prisma.LoadWhereInput = { status: { in: ["PLANNED", "ASSIGNED"] }, pickupAt: { lte: new Date(now.getTime() + DAY) } };
  const [loads, total] = await Promise.all([
    db.load.findMany({
      where,
      orderBy: { pickupAt: "asc" },
      take,
      select: {
        id: true, reference: true, status: true, priority: true, originCity: true, destCity: true, commodity: true, pickupAt: true, hazmat: true,
        customer: { select: { name: true } },
        team: { select: { name: true, color: true } },
        truck: { select: { unitNumber: true } },
        driver: { select: { name: true, hold: true } },
      },
    }),
    db.load.count({ where }),
  ]);
  return { loads, total };
}
export type UpcomingPickup = Awaited<ReturnType<typeof upcomingPickups>>["loads"][number];

export function recentEvents(take = 10) {
  return db.loadEvent.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, message: true, createdAt: true, load: { select: { id: true, reference: true } }, user: { select: { name: true } } },
  });
}
export type RecentEvent = Awaited<ReturnType<typeof recentEvents>>[number];

/** Loads waiting on paperwork or ready to bill, with their value. */
export async function billingQueue() {
  const rows = await db.load.groupBy({
    by: ["billingStage"],
    where: { billingStage: { in: ["MISSING_DOCS", "READY_TO_INVOICE"] } },
    _count: true,
    _sum: { rate: true },
  });
  const pick = (stage: string) => {
    const r = rows.find((x) => x.billingStage === stage);
    return { count: r?._count ?? 0, sum: r?._sum.rate ?? 0 };
  };
  return { missingDocs: pick("MISSING_DOCS"), ready: pick("READY_TO_INVOICE") };
}

/** Sent invoices past their due date (finance roles). Amount includes VAT, like receivables(). */
export async function overdueInvoices(now: Date) {
  const rows = await db.invoice.findMany({ where: { status: "SENT", dueAt: { lt: now } }, select: { amount: true, taxRate: true } });
  return { count: rows.length, amount: rows.reduce((a, i) => a + i.amount * (1 + i.taxRate), 0) };
}

/** Everything the KPI row needs that is not already in the fleet snapshot or stats. */
export async function operationalCounts(now: Date) {
  const soon = new Date(now.getTime() + DAY);
  const [loadsByStatus, unassignedSoon, pickupsSoon, boardByStatus, hold, onLeave] = await Promise.all([
    db.load.groupBy({ by: ["status"], _count: true }),
    db.load.count({ where: { status: "PLANNED", pickupAt: { lte: soon } } }),
    // Dispatched loads due inside the window: a subset of "Awaiting pickup", so the tile's hint never exceeds its value.
    db.load.count({ where: { status: "ASSIGNED", pickupAt: { gte: now, lte: soon } } }),
    db.driver.groupBy({ by: ["boardStatus"], where: { status: "ACTIVE" }, _count: true }),
    db.driver.count({ where: { status: "ACTIVE", hold: true } }),
    db.driver.count({ where: { status: "ON_LEAVE" } }),
  ]);
  const loads = (s: string) => loadsByStatus.find((c) => c.status === s)?._count ?? 0;
  const board = (s: string) => boardByStatus.find((c) => c.boardStatus === s)?._count ?? 0;
  const boardSum = (statuses: readonly string[]) => statuses.reduce((a, s) => a + board(s), 0);
  return {
    inTransit: loads("IN_TRANSIT"),
    assigned: loads("ASSIGNED"),
    planned: loads("PLANNED"),
    unassignedSoon,
    pickupsSoon,
    driversReady: board("READY"),
    /** On a load right now (dispatched, at pickup, en route, unloading). */
    driversWorking: boardSum(WORKING_STATUSES),
    /** Active drivers parked by hand: home, rest, stopped, vacation. */
    driversOff: boardSum(OFF_STATUSES),
    hold,
    onLeave,
  };
}
