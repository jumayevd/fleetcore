import "server-only";
import { Prisma } from "@prisma/client";
import { db, rootDb } from "./db";
import { DEFECT_DUE_DAYS } from "./constants";
import { dateOnly, type Formatter } from "./locale";
import { roLabel } from "./service";
import {
  BOARD_STATE_RANK, DAY_MS, NEEDS_STATES, byUnit, daysBetween, type BoardAction, type BoardState,
} from "./pti-shared";

/*
 * Pre-trip walk-arounds and defects: the server side of the inspections module.
 *
 *  - A WalkAround row (truck × week) is created lazily, the first time someone records something for that week.
 *    A truck without a row this week has sent nothing.
 *  - Defects are numbered per company (DEF-0001…): max + 1, retried when two people save at once.
 *  - The out-of-service rule: a defect with holdsUnit (every NOW defect) keeps its unit OUT_OF_SERVICE. When the last
 *    holding defect closes, the unit goes back into service: MAINTENANCE when a repair is in progress, else ACTIVE
 *    (trailers: SHOP, else YARD). The status before the hold is not stored.
 */

/* ------------------------------------------------------------------ */
/* Weeks                                                               */
/* ------------------------------------------------------------------ */

export type Week = {
  at: Date; key: string; end: Date;
  /** Neighbouring week keys (next is null for the current week: there is nothing to record yet). */
  prev: string; next: string | null;
  isCurrent: boolean;
};

/** The company week a "YYYY-MM-DD" key falls in (any day of it works), or this week. */
export function resolveWeek(f: Formatter, key?: string | null, now = new Date()): Week {
  const current = f.weekStart(now);
  const parsed = key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? f.parseDate(key) : null;
  const base = parsed && parsed.getTime() <= now.getTime() ? f.weekStart(new Date(parsed.getTime() + 12 * 3600_000)) : current;
  const shift = (n: number) => f.weekStart(new Date(base.at.getTime() + n * 7 * DAY_MS + 12 * 3600_000)).key;
  const isCurrent = base.key === current.key;
  return {
    at: base.at, key: base.key,
    end: new Date(base.at.getTime() + 6 * DAY_MS + 12 * 3600_000),
    prev: shift(-1), next: isCurrent ? null : shift(1), isCurrent,
  };
}

/** Keys of `n` weeks ending with `week` (newest first). */
export function weeksBack(f: Formatter, week: Week, n: number) {
  return Array.from({ length: n }, (_, i) => f.weekStart(new Date(week.at.getTime() - i * 7 * DAY_MS + 12 * 3600_000)));
}

/* ------------------------------------------------------------------ */
/* Defects                                                             */
/* ------------------------------------------------------------------ */

type NewDefect = Omit<Prisma.DefectUncheckedCreateInput, "number" | "companyId">;

/** Create a defect with the company's next number. A clash on the unique number simply takes the next one. */
export async function createDefect(data: NewDefect) {
  for (let attempt = 0; ; attempt++) {
    const { _max } = await db.defect.aggregate({ _max: { number: true } });
    try {
      return await db.defect.create({ data: { ...data, number: (_max.number ?? 0) + 1 } });
    } catch (e) {
      const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!clash || attempt >= 4) throw e;
    }
  }
}

/** When a defect of `severity` found at `foundAt` must be fixed by. */
export function dueFor(severity: string, foundAt: Date) {
  const days = DEFECT_DUE_DAYS[severity];
  return days == null ? null : new Date(foundAt.getTime() + days * DAY_MS);
}

export type UnitRef = { truckId?: string | null; trailerId?: string | null };
export type HoldChange = { held: string[]; released: string[] };

/**
 * Apply the out-of-service rule to a unit after its defects changed. A unit with a holding defect goes out of service;
 * with `released` (a holding defect was just closed or downgraded) and none left, it goes back into service. Returns the
 * unit numbers that changed, for the message shown to the person.
 */
export async function syncUnitHold(unit: UnitRef, opts: { released?: boolean } = {}): Promise<HoldChange> {
  const out: HoldChange = { held: [], released: [] };
  const now = new Date();
  if (unit.truckId) {
    const [truck, holding] = await Promise.all([
      db.truck.findUnique({ where: { id: unit.truckId }, select: { id: true, unitNumber: true, status: true } }),
      db.defect.count({ where: { truckId: unit.truckId, holdsUnit: true, status: { not: "CLOSED" } } }),
    ]);
    if (truck && truck.status !== "INACTIVE") {
      if (holding > 0 && truck.status !== "OUT_OF_SERVICE") {
        await db.truck.update({ where: { id: truck.id }, data: { status: "OUT_OF_SERVICE" } });
        out.held.push(truck.unitNumber);
      } else if (holding === 0 && opts.released && truck.status === "OUT_OF_SERVICE") {
        const inShop = await db.workOrder.count({ where: { truckId: truck.id, status: "IN_PROGRESS" } });
        await db.truck.update({ where: { id: truck.id }, data: { status: inShop ? "MAINTENANCE" : "ACTIVE" } });
        out.released.push(truck.unitNumber);
      }
    }
  }
  if (unit.trailerId) {
    const [trailer, holding] = await Promise.all([
      db.trailer.findUnique({ where: { id: unit.trailerId }, select: { id: true, unitNumber: true, status: true } }),
      db.defect.count({ where: { trailerId: unit.trailerId, holdsUnit: true, status: { not: "CLOSED" } } }),
    ]);
    if (trailer) {
      if (holding > 0 && trailer.status !== "OUT_OF_SERVICE") {
        // Out of service unhooks the trailer, as setting the status by hand does.
        await db.trailer.update({ where: { id: trailer.id }, data: { status: "OUT_OF_SERVICE", statusSince: now, truckId: null } });
        out.held.push(trailer.unitNumber);
      } else if (holding === 0 && opts.released && trailer.status === "OUT_OF_SERVICE") {
        const inShop = await db.workOrder.count({ where: { trailerId: trailer.id, status: "IN_PROGRESS" } });
        await db.trailer.update({ where: { id: trailer.id }, data: { status: inShop ? "SHOP" : "YARD", statusSince: now } });
        out.released.push(trailer.unitNumber);
      }
    }
  }
  return out;
}

/** Whether a truck must stay out of service because of a defect (for the shop: don't release it to ACTIVE). */
export async function truckHeldByDefects(truckId: string) {
  return (await db.defect.count({ where: { truckId, holdsUnit: true, status: { not: "CLOSED" } } })) > 0;
}

/** Members of the company who can own a defect (accounts go through rootDb on purpose). */
export async function companyMembers(companyId: string) {
  const rows = await rootDb.membership.findMany({
    // View-only members can't act on a defect, so they are never offered as its owner.
    where: { companyId, active: true, role: { not: "VIEWER" }, user: { active: true } },
    select: { role: true, user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.user.id, name: r.user.name, role: r.role })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Open repair orders per unit, as options for "link an existing repair". */
export async function openRepairsFor(units: UnitRef[]) {
  const truckIds = [...new Set(units.map((u) => u.truckId).filter((x): x is string => Boolean(x)))];
  const trailerIds = [...new Set(units.map((u) => u.trailerId).filter((x): x is string => Boolean(x)))];
  if (!truckIds.length && !trailerIds.length) return new Map<string, { id: string; label: string }[]>();
  const rows = await db.workOrder.findMany({
    where: { status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] }, voidedAt: null, OR: [{ truckId: { in: truckIds } }, { trailerId: { in: trailerIds } }] },
    select: { id: true, number: true, title: true, truckId: true, trailerId: true },
    orderBy: { number: "desc" },
  });
  const map = new Map<string, { id: string; label: string }[]>();
  for (const w of rows) {
    const key = w.truckId ?? w.trailerId!;
    map.set(key, [...(map.get(key) ?? []), { id: w.id, label: `${roLabel(w.number)} · ${w.title}` }]);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* The weekly board                                                    */
/* ------------------------------------------------------------------ */

export type BoardDefect = {
  id: string; number: number; component: string; description: string; severity: string; status: string;
  holdsUnit: boolean; daysOpen: number; overdue: boolean; repairedAt: Date | null;
  workOrder: { id: string; number: number; status: string } | null;
};

export type BoardRow = {
  truck: { id: string; unitNumber: string; status: string; make: string; model: string };
  driver: { id: string; name: string; phone: string | null; dispatcher: string | null } | null;
  /** Has a driver and is on the road (or held by a defect), so a video is expected this week. */
  expected: boolean;
  walk: {
    id: string; video: string; receivedAt: Date | null; reviewedAt: Date | null; reviewedBy: string | null;
    result: string | null; unseen: number;
  } | null;
  /** The latest reviewed walk-around up to this week. */
  last: { weekStart: Date; reviewedAt: Date; reviewedBy: string | null; result: string | null } | null;
  defects: BoardDefect[];
  holding: boolean;
  state: BoardState;
  action: BoardAction;
};

export type BoardCounts = {
  missing: number; review: number; openDefects: number; holdingTrucks: number; toConfirm: number;
  clean: number; sent: number; expected: number;
};

/** Every truck that is not retired, with where it stands for `week`. */
export async function loadBoard(week: Week, now = new Date()): Promise<{ rows: BoardRow[]; counts: BoardCounts }> {
  const weekStart = dateOnly(week.key);
  const since = dateOnly(new Date(week.at.getTime() - 26 * 7 * DAY_MS).toISOString().slice(0, 10));
  const [trucks, walks, lastReviewed, defects] = await Promise.all([
    db.truck.findMany({
      where: { status: { not: "INACTIVE" } },
      select: { id: true, unitNumber: true, status: true, make: true, model: true, driver: { select: { id: true, name: true, phone: true, dispatcher: true } } },
    }),
    db.walkAround.findMany({
      where: { weekStart },
      select: {
        id: true, truckId: true, video: true, receivedAt: true, reviewedAt: true, result: true, reviewedBy: { select: { name: true } },
        _count: { select: { ratings: { where: { rating: "UNSEEN" } } } },
      },
    }),
    db.walkAround.findMany({
      where: { reviewedAt: { not: null }, weekStart: { lte: weekStart, gte: since } },
      orderBy: { weekStart: "desc" },
      distinct: ["truckId"],
      select: { truckId: true, weekStart: true, reviewedAt: true, result: true, reviewedBy: { select: { name: true } } },
    }),
    db.defect.findMany({
      where: { truckId: { not: null }, status: { in: ["OPEN", "REPAIRED"] } },
      orderBy: [{ foundAt: "asc" }],
      select: {
        id: true, number: true, truckId: true, component: true, description: true, severity: true, status: true, holdsUnit: true,
        foundAt: true, dueAt: true, repairedAt: true, workOrder: { select: { id: true, number: true, status: true } },
      },
    }),
  ]);
  const walkBy = new Map(walks.map((w) => [w.truckId, w]));
  const lastBy = new Map(lastReviewed.map((w) => [w.truckId, w]));
  const defectsBy = new Map<string, BoardDefect[]>();
  for (const d of defects) {
    const list = defectsBy.get(d.truckId!) ?? [];
    list.push({
      id: d.id, number: d.number, component: d.component, description: d.description, severity: d.severity, status: d.status,
      holdsUnit: d.holdsUnit, daysOpen: daysBetween(d.foundAt, now), overdue: d.status === "OPEN" && !!d.dueAt && d.dueAt.getTime() < now.getTime(),
      repairedAt: d.repairedAt, workOrder: d.workOrder,
    });
    defectsBy.set(d.truckId!, list);
  }

  const rows: BoardRow[] = trucks.map((t) => {
    const w = walkBy.get(t.id);
    const l = lastBy.get(t.id);
    const list = (defectsBy.get(t.id) ?? []).sort((a, b) => Number(b.holdsUnit) - Number(a.holdsUnit) || a.number - b.number);
    const holding = list.some((d) => d.holdsUnit);
    const open = list.filter((d) => d.status === "OPEN").length;
    const repaired = list.filter((d) => d.status === "REPAIRED").length;
    const received = w?.video === "RECEIVED";
    const reviewed = Boolean(w?.reviewedAt);
    // On the road, or held by a defect (its video shows the repair). Parked out of service by hand or in the shop: excused.
    const expected = Boolean(t.driver) && (t.status === "ACTIVE" || (t.status === "OUT_OF_SERVICE" && holding));
    const unseen = w?._count.ratings ?? 0;
    const state: BoardState = holding ? "out_of_service"
      : received && !reviewed ? "review"
        : open ? "issues"
          : repaired ? "repaired"
            : expected && !received ? "missing"
              : reviewed && unseen ? "partial"
                : reviewed ? "clean"
                  : "not_expected";
    const action: BoardAction = received && !reviewed ? "review"
      : repaired ? "confirm"
        : expected && !received ? "chase"
          : open ? "review"
            : null;
    return {
      truck: { id: t.id, unitNumber: t.unitNumber, status: t.status, make: t.make, model: t.model },
      driver: t.driver,
      expected,
      walk: w ? { id: w.id, video: w.video, receivedAt: w.receivedAt, reviewedAt: w.reviewedAt, reviewedBy: w.reviewedBy?.name ?? null, result: w.result, unseen } : null,
      last: l?.reviewedAt ? { weekStart: l.weekStart, reviewedAt: l.reviewedAt, reviewedBy: l.reviewedBy?.name ?? null, result: l.result } : null,
      defects: list, holding, state, action,
    };
  });
  rows.sort((a, b) => BOARD_STATE_RANK[a.state] - BOARD_STATE_RANK[b.state] || byUnit(a.truck.unitNumber, b.truck.unitNumber));

  const expectedRows = rows.filter((r) => r.expected);
  const counts: BoardCounts = {
    missing: expectedRows.filter((r) => r.walk?.video !== "RECEIVED").length,
    review: rows.filter((r) => r.walk?.video === "RECEIVED" && !r.walk.reviewedAt).length,
    openDefects: rows.reduce((n, r) => n + r.defects.length, 0),
    holdingTrucks: rows.filter((r) => r.holding).length,
    toConfirm: rows.reduce((n, r) => n + r.defects.filter((d) => d.status === "REPAIRED").length, 0),
    clean: rows.filter((r) => r.state === "clean").length,
    sent: expectedRows.filter((r) => r.walk?.video === "RECEIVED").length,
    expected: expectedRows.length,
  };
  return { rows, counts };
}

export const needsSomething = (r: BoardRow) => NEEDS_STATES.includes(r.state);

/**
 * This week's walk-around numbers for the Today page: videos missing (due at the end of the week), waiting for review,
 * open defects and trucks they hold.
 */
export async function walkAroundSummary(f: Formatter, now = new Date()) {
  const week = resolveWeek(f, null, now);
  const { counts } = await loadBoard(week, now);
  return { weekKey: week.key, dueAt: week.end, ...counts };
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

/** Everything the review drawer needs for one truck and week. */
export async function loadReview(truckId: string, week: Week, f: Formatter, now = new Date()) {
  const truck = await db.truck.findUnique({
    where: { id: truckId },
    select: { id: true, unitNumber: true, make: true, model: true, year: true, status: true, driver: { select: { id: true, name: true, dispatcher: true } } },
  });
  if (!truck) return null;
  const weeks = weeksBack(f, week, 4);
  const [walk, open, history] = await Promise.all([
    db.walkAround.findUnique({
      where: { truckId_weekStart: { truckId, weekStart: dateOnly(week.key) } },
      include: {
        ratings: { select: { component: true, rating: true } },
        reviewedBy: { select: { name: true } },
        defects: { where: { status: { not: "CLOSED" } }, select: { id: true, number: true, component: true, description: true, severity: true, status: true } },
      },
    }),
    db.defect.findMany({
      where: { truckId, status: { in: ["OPEN", "REPAIRED"] } },
      orderBy: { number: "asc" },
      select: {
        id: true, number: true, component: true, description: true, severity: true, status: true, holdsUnit: true, foundAt: true,
        walkAroundId: true, workOrder: { select: { number: true, status: true } },
      },
    }),
    db.walkAround.findMany({
      where: { truckId, weekStart: { in: weeks.map((w) => dateOnly(w.key)) } },
      select: {
        weekStart: true, video: true, result: true, reviewedAt: true, reviewedBy: { select: { name: true } },
        ratings: { where: { rating: { in: ["SOON", "NOW", "UNSEEN"] } }, select: { component: true, rating: true } },
        _count: { select: { defects: true } },
      },
    }),
  ]);
  const historyBy = new Map(history.map((h) => [h.weekStart.toISOString().slice(0, 10), h]));
  return {
    truck,
    walk,
    earlier: open.filter((d) => d.walkAroundId !== walk?.id).map((d) => ({ ...d, daysOpen: daysBetween(d.foundAt, now) })),
    history: weeks.map((w) => ({ key: w.key, at: w.at, walk: historyBy.get(w.key) ?? null })),
  };
}
