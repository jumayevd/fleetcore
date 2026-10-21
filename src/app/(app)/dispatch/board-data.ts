import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { estimatedArrival, loadProgress, syncSimulatedPositions } from "@/lib/telemetry";
import { DAY_MS, dayRange, isYmd, todayYmd } from "./dates";
import { isRowColor, type BoardLoad, type BoardPayload, type BoardRow, type StatusEvent } from "./types";

export { todayYmd } from "./dates";

/* ------------------------------------------------------------------ */
/* Dates (company timezone)                                            */
/* ------------------------------------------------------------------ */

/** `date` query param → YYYY-MM-DD, falling back to today for anything that isn't a real calendar date. */
export function parseBoardDate(v: unknown) {
  return isYmd(v) ? v : todayYmd();
}

/** Key for BoardCell.date (`@db.Date`): UTC midnight of the calendar date, matching how cells are seeded. */
const cellDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

const loadSelect = {
  id: true, reference: true, status: true, priority: true, originCity: true, destCity: true, pickupAt: true, deliveryAt: true,
  departedAt: true, deliveredAt: true, distanceKm: true, trailerId: true, driverId: true,
  customer: { select: { name: true } },
  trailer: { select: { id: true, unitNumber: true, type: true } },
  documents: { select: { kind: true } },
  stops: { orderBy: { seq: "asc" as const }, select: { type: true, name: true, city: true, status: true, windowStart: true, windowEnd: true } },
} satisfies Prisma.LoadSelect;

type LoadRecord = Prisma.LoadGetPayload<{ select: typeof loadSelect }>;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

function toBoardLoad(l: LoadRecord, now: number): BoardLoad {
  const inTransit = l.status === "IN_TRANSIT";
  const progress = inTransit ? loadProgress(l, now) : 0;
  const eta = inTransit ? estimatedArrival(l) : null;
  const next = l.stops.find((s) => s.status !== "DONE") ?? null;
  return {
    id: l.id, reference: l.reference, status: l.status, customer: l.customer.name, originCity: l.originCity, destCity: l.destCity,
    pickupAt: l.pickupAt.toISOString(), deliveryAt: l.deliveryAt.toISOString(), departedAt: iso(l.departedAt), deliveredAt: iso(l.deliveredAt),
    distanceKm: l.distanceKm, progress, eta: iso(eta),
    late: Boolean(eta && eta.getTime() > l.deliveryAt.getTime()),
    latePickup: l.status === "ASSIGNED" && l.pickupAt.getTime() < now,
    hasRc: l.documents.some((d) => d.kind === "RC"),
    priority: l.priority,
    nextStop: next ? { type: next.type, name: next.name, city: next.city, status: next.status, windowStart: iso(next.windowStart), windowEnd: iso(next.windowEnd) } : null,
    stopsDone: l.stops.filter((s) => s.status === "DONE").length,
    stopsTotal: l.stops.length,
  };
}

/** Prefer the load that is actually moving, then the one dispatched, then whatever is left. */
const LOAD_RANK: Record<string, number> = { IN_TRANSIT: 0, ASSIGNED: 1, PLANNED: 2, DELIVERED: 3, INVOICED: 4, TONU: 5, CANCELLED: 6 };
const rankLoad = (l: LoadRecord) => LOAD_RANK[l.status] ?? 9;

/** The prebook rule: a dispatched load whose pickup is more than 24 h out reserves the driver without occupying them today. */
const isPrebooked = (l: { status: string; pickupAt: Date }, now: number) => l.status === "ASSIGNED" && l.pickupAt.getTime() > now + DAY_MS;

/** Each driver's last status before `end`, one row per driver (DISTINCT ON walks the (driverId, at) index). */
async function statusAsOf(end: Date, driverIds: string[]) {
  if (!driverIds.length) return [];
  // `at` is a timestamp without time zone holding UTC (Prisma's convention), so compare against the UTC wall time.
  return db.$queryRaw<{ driverId: string; status: string; source: string; at: Date }[]>`
    SELECT DISTINCT ON ("driverId") "driverId", "status", "source", "at"
    FROM "DriverStatusEvent"
    WHERE "at" < (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "driverId" IN (${Prisma.join(driverIds)})
    ORDER BY "driverId", "at" DESC`;
}

/**
 * Every active driver as a board row for `ymd`. Today shows the live active load (in transit, or dispatched with a pickup
 * inside 24 h); a dispatched load further out is carried as `prebooked` and leaves the driver Ready. Other dates show the
 * load whose pickup or delivery falls on that day plus the saved cells for that day. Past dates reconstruct each driver's
 * status from the status history.
 */
export async function loadBoardRows(ymd: string, opts: { teamId?: string | null } = {}): Promise<BoardPayload> {
  const today = ymd === todayYmd();
  const { start, end } = dayRange(ymd);
  const now = Date.now();
  const past = !today && end.getTime() <= now;
  if (today) await syncSimulatedPositions();

  const teamFilter: Prisma.DriverWhereInput = opts.teamId === undefined || opts.teamId === null ? {} : opts.teamId === "none" ? { teamId: null } : { teamId: opts.teamId };
  const active = { driverId: { not: null }, status: { in: ["ASSIGNED", "IN_TRANSIT"] } } satisfies Prisma.LoadWhereInput;

  const [drivers, loads, cells, activeLoads] = await Promise.all([
    db.driver.findMany({
      where: { status: { not: "INACTIVE" }, ...teamFilter },
      orderBy: [{ team: { sortOrder: "asc" } }, { name: "asc" }],
      select: {
        id: true, name: true, phone: true, phone2: true, type: true, hold: true, holdReason: true, status: true,
        boardStatus: true, boardStatusSince: true, boardStatusManual: true,
        team: { select: { id: true, name: true, color: true } },
        truck: {
          select: {
            id: true, unitNumber: true, locationName: true, fuelPct: true, lastPingAt: true, speedKmh: true,
            trailers: { select: { id: true, unitNumber: true, type: true }, take: 1, orderBy: { unitNumber: "asc" } },
          },
        },
      },
    }),
    db.load.findMany({
      where: today ? active : { driverId: { not: null }, status: { not: "CANCELLED" }, OR: [{ pickupAt: { gte: start, lt: end } }, { deliveryAt: { gte: start, lt: end } }] },
      select: loadSelect,
    }),
    db.boardCell.findMany({ where: { date: cellDate(ymd) }, select: { driverId: true, column: true, color: true, note: true } }),
    // Upcoming days show today's status, so they need today's active loads to apply the prebook rule as well.
    !today && !past ? db.load.findMany({ where: active, select: { id: true, reference: true, driverId: true, status: true, pickupAt: true } }) : Promise.resolve(null),
  ]);
  const history = past ? await statusAsOf(end, drivers.map((d) => d.id)) : [];

  const loadByDriver = new Map<string, LoadRecord>();
  for (const l of loads) {
    if (today && isPrebooked(l, now)) continue;
    const cur = loadByDriver.get(l.driverId!);
    if (!cur || rankLoad(l) < rankLoad(cur)) loadByDriver.set(l.driverId!, l);
  }
  // Earliest prebooked load per driver, and which drivers have something on right now (in transit or pickup inside 24 h).
  const prebookBy = new Map<string, { id: string; reference: string; pickupAt: Date }>();
  const busyNow = new Set<string>();
  for (const l of past ? [] : today ? loads : (activeLoads ?? [])) {
    if (!isPrebooked(l, now)) { busyNow.add(l.driverId!); continue; }
    const cur = prebookBy.get(l.driverId!);
    if (!cur || l.pickupAt < cur.pickupAt) prebookBy.set(l.driverId!, { id: l.id, reference: l.reference, pickupAt: l.pickupAt });
  }
  const cellBy = new Map<string, { color: string | null; note: string | null }>();
  for (const c of cells) {
    const e = cellBy.get(c.driverId) ?? { color: null, note: null };
    if (c.column === "row") e.color = c.color;
    if (c.column === "notes") e.note = c.note;
    cellBy.set(c.driverId, e);
  }
  const histBy = new Map(history.map((h) => [h.driverId, h]));

  const rows: BoardRow[] = drivers.map((d) => {
    const l = loadByDriver.get(d.id);
    const h = past ? histBy.get(d.id) : undefined;
    const cell = cellBy.get(d.id);
    const pre = prebookBy.get(d.id);
    // workflow.ts derives Dispatched from any assigned load; a load that is only prebooked doesn't occupy the driver today.
    const liveStatus = pre && !busyNow.has(d.id) && !d.boardStatusManual && d.boardStatus === "DISPATCHED" ? "READY" : d.boardStatus;
    return {
      driver: { id: d.id, name: d.name, phone: d.phone, phone2: d.phone2, type: d.type, hold: d.hold, holdReason: d.holdReason, employment: d.status },
      team: d.team,
      status: h?.status ?? liveStatus,
      statusSince: (h?.at ?? d.boardStatusSince).toISOString(),
      statusManual: h ? h.source === "MANUAL" : d.boardStatusManual,
      statusMode: today ? "live" : past ? "history" : "projected",
      truck: d.truck
        ? { id: d.truck.id, unitNumber: d.truck.unitNumber, locationName: d.truck.locationName, fuelPct: d.truck.fuelPct, lastPingAt: iso(d.truck.lastPingAt), speedKmh: d.truck.speedKmh }
        : null,
      trailer: l?.trailer ?? d.truck?.trailers[0] ?? null,
      load: l ? toBoardLoad(l, now) : null,
      prebooked: pre ? { id: pre.id, reference: pre.reference, pickupAt: pre.pickupAt.toISOString() } : null,
      cell: { color: isRowColor(cell?.color) ? cell!.color : null, note: cell?.note ?? null },
    };
  });

  return { date: ymd, today, rows, at: new Date(now).toISOString(), dayEnd: end.toISOString() };
}

/** Status history for the drawer, newest first. */
export async function driverStatusHistory(driverId: string, take = 60): Promise<StatusEvent[]> {
  const events = await db.driverStatusEvent.findMany({
    where: { driverId }, orderBy: { at: "desc" }, take,
    select: { id: true, status: true, source: true, note: true, at: true, user: { select: { name: true } } },
  });
  return events.map((e) => ({ id: e.id, status: e.status, source: e.source, note: e.note, user: e.user?.name ?? null, at: e.at.toISOString() }));
}

/** Most loads the prebook view renders at once; the headline count is always the full number. */
const PREBOOK_LIMIT = 300;

/** Loads for the prebook view: booked or dispatched with a pickup more than 24 h out. `at` is the timestamp the rule was evaluated at. */
export async function prebookLoads() {
  const at = Date.now();
  const where = { status: { in: ["PLANNED", "ASSIGNED"] }, pickupAt: { gt: new Date(at + DAY_MS) } } satisfies Prisma.LoadWhereInput;
  const [loads, total] = await Promise.all([
    db.load.findMany({
      where,
      orderBy: { pickupAt: "asc" },
      take: PREBOOK_LIMIT,
      include: {
        customer: { select: { name: true } },
        team: { select: { id: true, name: true, color: true } },
        driver: { select: { id: true, name: true, type: true, hold: true } },
        truck: { select: { id: true, unitNumber: true } },
        // Only RC presence is shown.
        documents: { where: { kind: "RC" }, select: { kind: true }, take: 1 },
      },
    }),
    db.load.count({ where }),
  ]);
  return { at, loads, total, limit: PREBOOK_LIMIT };
}
