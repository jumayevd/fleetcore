import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { startOfWeek } from "date-fns";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, canOpen, type Permission } from "@/lib/permissions";
import { getAlerts } from "@/lib/alerts";
import { receivables as receivablesAging, weeklyProduction } from "@/lib/stats";
import { estimatedArrival, loadProgress } from "@/lib/telemetry";
import {
  BOARD_STATUSES, BOARD_STATUS_LABELS, CLAIM_FAULT_LABELS, CLAIM_OPEN_STATUSES, CLAIM_TYPE_LABELS, DRIVER_TYPE_LABELS,
  LOAD_STATUSES, LOAD_STATUS_LABELS, OWNERSHIP, OWNERSHIP_LABELS, REQUIRED_LOAD_DOCS, TIMEZONE, TRAILER_STATUS_LABELS, TRUCK_STATUSES,
  WORK_ORDER_CATEGORY_LABELS, humanize, type BoardStatus, type LoadStatus,
} from "@/lib/constants";
import { currentMotion } from "./motion";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Hard cap on list sizes handed to the model. */
export const LIMIT = 25;
/** Hard ceiling on rows read for the checks that can only run in memory (service due by odometer, late in-transit loads). */
const SCAN = 500;
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Above this speed a truck is rolling; at or below it, stationary. */
const ROLLING_KMH = 5;
/** Service due inside this many km is "due soon" (same rule as the fleet page and alerts). */
const PM_DUE_SOON_KM = 2000;
const ACTIVE_LOAD = ["ASSIGNED", "IN_TRANSIT"] as const;

const dt = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const d = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, day: "2-digit", month: "short", year: "numeric" });
/** "03 Oct 2026, 14:05" in the company timezone. */
const fmtDateTime = (v: Date | null | undefined) => (v ? dt.format(v) : null);
const fmtDate = (v: Date | null | undefined) => (v ? d.format(v) : null);
const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;
const daysSince = (v: Date, now = Date.now()) => Math.floor((now - v.getTime()) / DAY);
const daysUntil = (v: Date | null | undefined, now = Date.now()) => (v ? Math.ceil((v.getTime() - now) / DAY) : null);
const label = <T extends string>(map: Record<string, string>, v: T) => map[v] ?? humanize(v);
const loadLabel = (s: string) => label(LOAD_STATUS_LABELS, s as LoadStatus);
const boardLabel = (s: string) => label(BOARD_STATUS_LABELS, s as BoardStatus);
const truckStatusLabel = (s: string) => (s === "MAINTENANCE" ? "In shop" : humanize(s));
const like = (q: string) => ({ contains: q, mode: "insensitive" as const });

/** Control characters (NUL and friends) break Postgres text queries and have no place in a search. */
const printable = (s: string) => [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
/** Required free text (a reference or a search): trimmed before the length check, printable only. */
const queryText = (desc: string) => z.string().trim().min(2).max(80).refine(printable, "Use printable characters only").describe(desc);
/** Optional free-text filter: trimmed; empty means no filter. */
const filterText = (desc: string) => z.string().trim().max(80).refine(printable, "Use printable characters only").optional().describe(desc);

/** Cap a list and say so, so the model can tell the user "showing 25 of 61". */
function capped<T>(rows: T[], key: string) {
  return { total: rows.length, showing: Math.min(LIMIT, rows.length), truncated: rows.length > LIMIT, [key]: rows.slice(0, LIMIT) };
}

type PmInput = { odometerKm: number; pmIntervalKm: number; lastPmKm: number | null; nextServiceKm: number | null };
/** Next service = explicit nextServiceKm, else last PM + interval. kmLeft < 0 means overdue. */
function pmStatus(t: PmInput) {
  const next = t.nextServiceKm ?? (t.lastPmKm != null ? t.lastPmKm + t.pmIntervalKm : null);
  if (next == null) return { nextServiceKm: null, kmLeft: null, state: "unknown" as const };
  const left = next - t.odometerKm;
  return { nextServiceKm: next, kmLeft: left, state: left < 0 ? ("overdue" as const) : left < PM_DUE_SOON_KM ? ("due soon" as const) : ("ok" as const) };
}
const PM_FIELDS = { odometerKm: true, pmIntervalKm: true, lastPmKm: true, nextServiceKm: true } satisfies Prisma.TruckSelect;

type RiskInput = { score: number; licenseExpiry: Date; medicalExpiry: Date | null };
/** Same rule as the drivers page: score under 75, or licence / medical expired or expiring within 30 days. */
function riskReasons(dr: RiskInput, now = Date.now()) {
  const out: string[] = [];
  if (dr.score < 75) out.push(`score ${dr.score}`);
  const lic = daysUntil(dr.licenseExpiry, now)!;
  if (lic < 0) out.push(`licence expired ${-lic}d ago`); else if (lic <= 30) out.push(`licence expires in ${lic}d`);
  const med = daysUntil(dr.medicalExpiry, now);
  if (med != null) { if (med < 0) out.push(`medical expired ${-med}d ago`); else if (med <= 30) out.push(`medical expires in ${med}d`); }
  return out;
}

const missingLoadDocs = (docs: { kind: string }[]) => {
  const have = new Set(docs.map((x) => x.kind));
  return REQUIRED_LOAD_DOCS.filter((k) => !have.has(k));
};

type Timed = { departedAt: Date | null; distanceKm: number; deliveryAt: Date };
/**
 * How late an in-transit load is: the later of its route ETA and now, against the delivery time. A load
 * still in transit after its delivery time is late even when the route estimate says it should be there.
 */
function lateness(l: Timed, now: number) {
  const eta = estimatedArrival(l);
  const lateMs = Math.max(eta?.getTime() ?? now, now) - l.deliveryAt.getTime();
  return { eta, late: lateMs > 0, hoursLate: lateMs > 0 ? round(lateMs / HOUR, 1) : 0, overdueNotDelivered: l.deliveryAt.getTime() < now };
}

/** What the model gets when a lookup throws: no stack, no SQL, no file paths (the real error goes to the server log). */
const LOOKUP_FAILED = { error: "That lookup failed. Ask the user to try again." } as const;

/* ------------------------------------------------------------------ */
/* Money visibility: one source of truth for the tools and the prompt  */
/* ------------------------------------------------------------------ */

/**
 * Which money a role may see, mirroring the pages. Tool output leaves out anything a role may not see —
 * the raw tool output also streams to the browser, so the system prompt is guidance, not the boundary.
 */
export function moneyAccess(role: string) {
  return {
    /** Rate, driver pay, fuel and other costs, margin, rate per km and the load's invoice: the load page's Financials card. */
    loads: can(role, "finance.view") || can(role, "loads.edit"),
    /** Invoices, receivables and billing-queue totals: /finance. */
    finance: can(role, "finance.view"),
    /** Weekly revenue against goals: /dispatch/weekly, open to loads.view (the weeklyProduction tool's own permission). */
    production: can(role, "loads.view"),
    /** Amounts claimed: /claims, open to claims.view (the openClaims tool's own permission). */
    claims: can(role, "claims.view"),
  };
}
export type MoneyAccess = ReturnType<typeof moneyAccess>;

/* ------------------------------------------------------------------ */
/* Row selects and views                                               */
/* ------------------------------------------------------------------ */

/** Keeps an href only when the role can open it; JSON drops `undefined`, so the key disappears. */
type Linker = (href: string) => string | undefined;
type ViewOpts = { money: boolean; link: Linker };

/** Compact load row shared by several tools. */
const LOAD_ROW = {
  id: true, reference: true, status: true, priority: true, billingStage: true, customerRef: true,
  originCity: true, originName: true, destCity: true, destName: true, pickupAt: true, deliveryAt: true, departedAt: true, deliveredAt: true,
  distanceKm: true, emptyKm: true, rate: true, commodity: true, weightKg: true, equipment: true, hazmat: true,
  customer: { select: { name: true } }, broker: { select: { name: true } }, team: { select: { name: true } },
  driver: { select: { id: true, name: true, phone: true, hold: true } }, truck: { select: { id: true, unitNumber: true } }, trailer: { select: { unitNumber: true } },
  documents: { select: { kind: true } },
} satisfies Prisma.LoadSelect;
type LoadRow = Prisma.LoadGetPayload<{ select: typeof LOAD_ROW }>;

function loadView(l: LoadRow, v: ViewOpts) {
  return {
    reference: l.reference, href: v.link(`/loads/${l.id}`), status: loadLabel(l.status), priority: humanize(l.priority),
    customer: l.customer.name, broker: l.broker?.name ?? null, customerRef: l.customerRef, team: l.team?.name ?? null,
    route: `${l.originCity} → ${l.destCity}`, pickupAt: fmtDateTime(l.pickupAt), deliveryAt: fmtDateTime(l.deliveryAt),
    departedAt: fmtDateTime(l.departedAt), deliveredAt: fmtDateTime(l.deliveredAt),
    distanceKm: round(l.distanceKm), emptyKm: round(l.emptyKm), commodity: l.commodity, weightKg: round(l.weightKg), equipment: humanize(l.equipment), hazmat: l.hazmat,
    driver: l.driver ? { name: l.driver.name, phone: l.driver.phone, hold: l.driver.hold, href: v.link(`/drivers/${l.driver.id}`) } : null,
    truck: l.truck ? { unit: l.truck.unitNumber, href: v.link(`/fleet/${l.truck.id}`) } : null, trailer: l.trailer?.unitNumber ?? null,
    hasRateConfirmation: l.documents.some((x) => x.kind === "RC"), hasProofOfDelivery: l.documents.some((x) => x.kind === "POD"),
    billingStage: humanize(l.billingStage),
    ...(v.money ? { rateUsd: round(l.rate), revenuePerKm: l.distanceKm ? round(l.rate / l.distanceKm, 2) : null } : {}),
  };
}

/** What the route simulation needs from a load (see motion.ts). */
const ROUTE = {
  departedAt: true, distanceKm: true, originLat: true, originLng: true, destLat: true, destLng: true,
  stops: { select: { lat: true, lng: true, seq: true, status: true, city: true } },
} satisfies Prisma.LoadSelect;
const MOTION_FIELDS = { unitNumber: true, speedKmh: true, engineOn: true, fuelPct: true, locationName: true, lastPingAt: true, pingSource: true } satisfies Prisma.TruckSelect;

const TRUCK_ROW = {
  id: true, make: true, model: true, year: true, plate: true, status: true, ownership: true, group: true, lessor: true,
  ...PM_FIELDS, ...MOTION_FIELDS, lastPmAt: true, insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true,
  driver: { select: { id: true, name: true, phone: true, hold: true, boardStatus: true } },
  loads: { where: { status: { in: [...ACTIVE_LOAD] } }, orderBy: { pickupAt: "asc" as const }, take: 2, select: { id: true, reference: true, status: true, destCity: true, deliveryAt: true, ...ROUTE } },
} satisfies Prisma.TruckSelect;
type TruckRow = Prisma.TruckGetPayload<{ select: typeof TRUCK_ROW }>;

function truckView(t: TruckRow, v: ViewOpts, now = Date.now()) {
  // The load on the road wins over an earlier-booked one that hasn't started (same rule as the live map).
  const transit = t.loads.find((x) => x.status === "IN_TRANSIT");
  const l = transit ?? t.loads[0];
  const pm = pmStatus(t);
  const m = currentMotion(t, transit, now);
  return {
    unit: t.unitNumber, href: v.link(`/fleet/${t.id}`), vehicle: `${t.year} ${t.make} ${t.model}`, plate: t.plate,
    status: truckStatusLabel(t.status), ownership: label(OWNERSHIP_LABELS, t.ownership), group: t.group, lessor: t.lessor,
    driver: t.driver ? { name: t.driver.name, phone: t.driver.phone, boardStatus: boardLabel(t.driver.boardStatus), hold: t.driver.hold, href: v.link(`/drivers/${t.driver.id}`) } : null,
    currentLoad: l ? { reference: l.reference, status: loadLabel(l.status), to: l.destCity, deliveryAt: fmtDateTime(l.deliveryAt), eta: fmtDateTime(l.status === "IN_TRANSIT" ? estimatedArrival(l) : null), progressPct: l.status === "IN_TRANSIT" ? round(loadProgress(l, now) * 100) : null, href: v.link(`/loads/${l.id}`) } : null,
    motion: m.speedKmh > ROLLING_KMH ? "rolling" : m.engineOn ? "stopped (engine on)" : "stopped", speedKmh: round(m.speedKmh), location: m.location,
    position: { source: m.source, asOf: fmtDateTime(m.at) }, fuelPct: m.fuelPct == null ? null : round(m.fuelPct),
    odometerKm: t.odometerKm, service: { ...pm, lastPmAt: fmtDate(t.lastPmAt), intervalKm: t.pmIntervalKm },
    papers: { insurance: fmtDate(t.insuranceExpiry), inspection: fmtDate(t.inspectionExpiry), registration: fmtDate(t.registrationExpiry) },
  };
}

/** Light truck row for the service-due scan. */
const SERVICE_ROW = {
  id: true, unitNumber: true, make: true, model: true, year: true, status: true, locationName: true, lastPmAt: true, ...PM_FIELDS,
  driver: { select: { name: true } },
  loads: { where: { status: { in: [...ACTIVE_LOAD] } }, orderBy: { pickupAt: "asc" as const }, take: 1, select: { reference: true } },
} satisfies Prisma.TruckSelect;

/** Light load row for the billing queue. */
const BILLING_ROW = {
  id: true, reference: true, status: true, originCity: true, destCity: true, deliveredAt: true, deliveryAt: true, rate: true,
  customer: { select: { name: true } }, broker: { select: { name: true } }, documents: { select: { kind: true } },
} satisfies Prisma.LoadSelect;

/* ------------------------------------------------------------------ */
/* Tool set                                                            */
/* ------------------------------------------------------------------ */

export type ToolContext = { role: string };

/** Which permission each tool needs. Tools the role cannot use are not offered to the model at all. */
export const TOOL_PERMISSION = {
  fleetStatus: "fleet.view", listTrucks: "fleet.view", maintenanceDue: "fleet.view",
  listDrivers: "drivers.view",
  lateLoads: "loads.view", loadsByStatus: "loads.view", findLoad: "loads.view", weeklyProduction: "loads.view",
  billingQueue: "finance.view", receivables: "finance.view",
  openClaims: "claims.view",
  alerts: "dashboard.view",
  searchEverything: "dashboard.view",
} as const satisfies Record<string, Permission>;
export type AssistantToolName = keyof typeof TOOL_PERMISSION;
const TOOL_NAMES = Object.keys(TOOL_PERMISSION) as AssistantToolName[];

export const allowedTools = (role: string) => TOOL_NAMES.filter((n) => can(role, TOOL_PERMISSION[n]));

/**
 * Read-only tools, closed over the caller's role: none of them writes to the database. Every tool
 * re-checks its permission (a mis-routed call never leaks data, even though disallowed tools are not
 * offered to the model) and contains its own errors.
 */
export function buildAssistantTools(ctx: ToolContext) {
  const access = moneyAccess(ctx.role);
  const link: Linker = (href) => (canOpen(ctx.role, href) ? href : undefined);
  const view: ViewOpts = { money: access.loads, link };

  /** Permission re-check plus error containment: a thrown error is logged here and never reaches the model. */
  async function safely<T>(name: AssistantToolName, run: () => Promise<T>) {
    if (!can(ctx.role, TOOL_PERMISSION[name])) return { error: `Your role cannot use ${name}. Say that this information is not available to you.` };
    try {
      return await run();
    } catch (error) {
      console.error(`[assistant] tool ${name} failed`, error);
      return LOOKUP_FAILED;
    }
  }

  return {
    fleetStatus: tool({
      description: "Fleet snapshot right now: trucks by status, active trucks by make, how many active trucks are rolling, stationary, on a load, idle or without a driver, trailers by status, drivers by board status, and active loads by status. Idle = an active truck with a driver and no dispatched or in-transit load (the same rule and count as listTrucks idle=true); stationary = at or below 5 km/h right now, including trucks stopped while on a load. Use this first for 'how is the fleet doing' and 'how many' questions; use listTrucks to name the trucks.",
      inputSchema: z.object({}),
      execute: () => safely("fleetStatus", async () => {
        const now = Date.now();
        const [byStatus, byMake, active, trailers, drivers, loads, busy, transit] = await Promise.all([
          db.truck.groupBy({ by: ["status"], _count: true }),
          db.truck.groupBy({ by: ["make"], where: { status: "ACTIVE" }, _count: true }),
          db.truck.findMany({ where: { status: "ACTIVE" }, select: { id: true, driverId: true, ...MOTION_FIELDS } }),
          db.trailer.groupBy({ by: ["status"], _count: true }),
          db.driver.findMany({ where: { status: { not: "INACTIVE" } }, select: { boardStatus: true, hold: true, status: true } }),
          db.load.groupBy({ by: ["status"], _count: true, where: { status: { in: ["PLANNED", "ASSIGNED", "IN_TRANSIT", "DELIVERED"] } } }),
          db.load.findMany({ where: { status: { in: [...ACTIVE_LOAD] }, truckId: { not: null } }, select: { truckId: true }, distinct: ["truckId"] }),
          db.load.findMany({ where: { status: "IN_TRANSIT", truckId: { not: null } }, select: { truckId: true, ...ROUTE } }),
        ]);
        const onLoad = new Set(busy.map((l) => l.truckId));
        const route = new Map(transit.map((l) => [l.truckId, l]));
        const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
        const rolling = count(active, (t) => currentMotion(t, route.get(t.id), now).speedKmh > ROLLING_KMH);
        return {
          asOf: fmtDateTime(new Date(now)),
          trucks: {
            total: byStatus.reduce((a, r) => a + r._count, 0),
            byStatus: Object.fromEntries(TRUCK_STATUSES.map((s) => [truckStatusLabel(s), byStatus.find((r) => r.status === s)?._count ?? 0])),
            active: active.length,
            activeByMake: Object.fromEntries([...byMake].sort((a, b) => b._count - a._count || a.make.localeCompare(b.make)).map((r) => [r.make, r._count])),
            rolling,
            stationary: active.length - rolling,
            onLoad: count(active, (t) => onLoad.has(t.id)),
            idle: count(active, (t) => t.driverId != null && !onLoad.has(t.id)),
            withoutDriver: count(active, (t) => t.driverId == null),
          },
          trailers: Object.fromEntries(trailers.map((r) => [label(TRAILER_STATUS_LABELS, r.status), r._count])),
          drivers: {
            working: drivers.length,
            onHold: count(drivers, (x) => x.hold),
            onLeave: count(drivers, (x) => x.status === "ON_LEAVE"),
            byBoardStatus: Object.fromEntries(BOARD_STATUSES.map((s) => [boardLabel(s), count(drivers, (x) => x.boardStatus === s)]).filter(([, n]) => n)),
          },
          loads: Object.fromEntries(loads.map((r) => [loadLabel(r.status), r._count])),
          hints: {
            idle: "active truck with a driver and no dispatched or in-transit load: spare capacity (listTrucks idle=true names them)",
            stationary: "active truck at or below 5 km/h right now, including trucks stopped while on a load; not the same as idle",
            withoutDriver: "active truck with no driver assigned (listTrucks status=ACTIVE hasDriver=false names them)",
            positions: "speeds for trucks on an in-transit load are estimated along the route unless a device pinged in the last 5 minutes; other trucks report their last ping",
          },
        };
      }),
    }),

    listTrucks: tool({
      description: "List trucks with filters: status, ownership, fleet group, make, hasDriver (false = trucks with no driver), idle (active trucks with a driver and no dispatched or in-transit load: spare capacity, the same count as fleetStatus idle), pmOverdue (past the service interval). Returns the total that match and up to 25 trucks with driver, current load, motion, location, odometer, service and paperwork dates.",
      inputSchema: z.object({
        status: z.enum(TRUCK_STATUSES).optional().describe("ACTIVE | MAINTENANCE (in shop) | OUT_OF_SERVICE | INACTIVE"),
        ownership: z.enum(OWNERSHIP).optional().describe("COMPANY | OWNER_OPERATOR | LEASED"),
        group: filterText("Fleet group / company label (case-insensitive contains)"),
        make: filterText("Make such as Volvo, MAN or Scania (case-insensitive contains)"),
        hasDriver: z.boolean().optional().describe("true = only trucks with a driver assigned; false = only trucks with no driver"),
        idle: z.boolean().optional().describe("true = only idle trucks: active, with a driver, no dispatched or in-transit load"),
        pmOverdue: z.boolean().optional().describe("true = only trucks whose service is overdue"),
      }),
      execute: (f) => safely("listTrucks", async () => {
        const where: Prisma.TruckWhereInput = {
          AND: [
            f.status ? { status: f.status } : {},
            f.ownership ? { ownership: f.ownership } : {},
            f.group ? { group: like(f.group) } : {},
            f.make ? { make: like(f.make) } : {},
            f.hasDriver === true ? { driverId: { not: null } } : f.hasDriver === false ? { driverId: null } : {},
            f.idle ? { status: "ACTIVE", driverId: { not: null }, loads: { none: { status: { in: [...ACTIVE_LOAD] } } } } : {},
          ],
        };
        const now = Date.now();
        const orderBy = { unitNumber: "asc" } as const;
        if (f.pmOverdue) {
          // Service due is odometer arithmetic, so it is checked in memory over a bounded scan of light rows.
          const scan = await db.truck.findMany({ where, orderBy, take: SCAN, select: { id: true, ...PM_FIELDS } });
          const ids = scan.filter((t) => pmStatus(t).state === "overdue").map((t) => t.id);
          const rows = await db.truck.findMany({ where: { id: { in: ids.slice(0, LIMIT) } }, orderBy, select: TRUCK_ROW });
          return {
            filters: f, total: ids.length, showing: rows.length, truncated: ids.length > rows.length,
            ...(scan.length === SCAN ? { scanLimit: `checked the first ${SCAN} trucks only` } : {}),
            trucks: rows.map((t) => truckView(t, view, now)),
          };
        }
        const [total, rows] = await Promise.all([db.truck.count({ where }), db.truck.findMany({ where, orderBy, take: LIMIT, select: TRUCK_ROW })]);
        return { filters: f, total, showing: rows.length, truncated: total > rows.length, trucks: rows.map((t) => truckView(t, view, now)) };
      }),
    }),

    listDrivers: tool({
      description: "List drivers (not inactive unless asked) with filters: boardStatus (dispatch board state), team name, hold (on hold, with the reason), hasTruck (false = drivers with no truck), atRisk (score under 75, or licence / medical expired or expiring within 30 days). Returns the total that match and up to 25 drivers with phone, truck, current load, status since, score and paperwork dates.",
      inputSchema: z.object({
        boardStatus: z.enum(BOARD_STATUSES).optional().describe("READY | DISPATCHED | AT_PICKUP | EN_ROUTE | UNLOADING | STOP | REST | HOME | VACATION"),
        team: filterText("Dispatcher team name (case-insensitive contains)"),
        hold: z.boolean().optional().describe("true = only drivers on hold"),
        hasTruck: z.boolean().optional().describe("true = only drivers with a truck assigned; false = only drivers without a truck"),
        atRisk: z.boolean().optional().describe("true = only at-risk drivers"),
        includeInactive: z.boolean().optional().describe("Include drivers who no longer work here"),
      }),
      execute: (f) => safely("listDrivers", async () => {
        const now = Date.now();
        const soon = new Date(now + 30 * DAY);
        const where: Prisma.DriverWhereInput = {
          AND: [
            f.includeInactive ? {} : { status: { not: "INACTIVE" } },
            f.boardStatus ? { boardStatus: f.boardStatus } : {},
            f.team ? { team: { name: like(f.team) } } : {},
            f.hold ? { hold: true } : {},
            f.hasTruck === true ? { truck: { isNot: null } } : f.hasTruck === false ? { truck: { is: null } } : {},
            // Same rule as riskReasons(): "expiring within 30 days" includes already expired.
            f.atRisk ? { OR: [{ score: { lt: 75 } }, { licenseExpiry: { lte: soon } }, { medicalExpiry: { lte: soon } }] } : {},
          ],
        };
        const [total, drivers] = await Promise.all([
          db.driver.count({ where }),
          db.driver.findMany({
            where,
            orderBy: { name: "asc" },
            take: LIMIT,
            select: {
              id: true, name: true, phone: true, status: true, type: true, boardStatus: true, boardStatusSince: true, boardStatusManual: true, hold: true, holdReason: true,
              score: true, licenseExpiry: true, medicalExpiry: true, hireDate: true,
              team: { select: { name: true } }, truck: { select: { id: true, unitNumber: true } },
              loads: { where: { status: { in: [...ACTIVE_LOAD] } }, orderBy: { status: "desc" }, take: 1, select: { id: true, reference: true, status: true, destCity: true, deliveryAt: true } },
            },
          }),
        ]);
        return {
          filters: f, total, showing: drivers.length, truncated: total > drivers.length,
          drivers: drivers.map((x) => {
            const l = x.loads[0];
            return {
              name: x.name, href: link(`/drivers/${x.id}`), phone: x.phone, employment: humanize(x.status), type: label(DRIVER_TYPE_LABELS, x.type), team: x.team?.name ?? null,
              boardStatus: boardLabel(x.boardStatus), since: fmtDateTime(x.boardStatusSince), hoursInStatus: round((now - x.boardStatusSince.getTime()) / HOUR), manualOverride: x.boardStatusManual,
              hold: x.hold, holdReason: x.hold ? (x.holdReason ?? "no reason recorded") : null,
              truck: x.truck ? { unit: x.truck.unitNumber, href: link(`/fleet/${x.truck.id}`) } : null,
              currentLoad: l ? { reference: l.reference, status: loadLabel(l.status), to: l.destCity, deliveryAt: fmtDateTime(l.deliveryAt), href: link(`/loads/${l.id}`) } : null,
              score: x.score, riskReasons: riskReasons(x, now), licenceExpires: fmtDate(x.licenseExpiry), medicalExpires: fmtDate(x.medicalExpiry), hired: fmtDate(x.hireDate),
            };
          }),
        };
      }),
    }),

    lateLoads: tool({
      description: "What is running late: in-transit loads that will miss or have already missed their delivery time (hours late; a load still in transit after its delivery time counts even when the route estimate has passed), dispatched loads whose pickup time has passed without departing, and booked loads with pickup inside 24 hours that still have no truck or driver. Each bucket has a total and up to 25 loads.",
      inputSchema: z.object({}),
      execute: () => safely("lateLoads", async () => {
        const now = Date.now();
        const pickupOverdue: Prisma.LoadWhereInput = { status: "ASSIGNED", pickupAt: { lt: new Date(now) } };
        const unassigned: Prisma.LoadWhereInput = { status: "PLANNED", pickupAt: { lte: new Date(now + DAY) } };
        // Lateness is ETA arithmetic, so in-transit loads (at most one per truck) are checked in memory over light rows.
        const transit = await db.load.findMany({ where: { status: "IN_TRANSIT" }, take: SCAN, select: { id: true, departedAt: true, distanceKm: true, deliveryAt: true } });
        const late = transit.map((l) => ({ id: l.id, ...lateness(l, now) })).filter((x) => x.late).sort((a, b) => b.hoursLate - a.hoursLate);
        const byId = new Map(late.map((x) => [x.id, x]));
        const [lateRows, assigned, assignedTotal, planned, plannedTotal] = await Promise.all([
          db.load.findMany({ where: { id: { in: late.slice(0, LIMIT).map((x) => x.id) } }, select: LOAD_ROW }),
          db.load.findMany({ where: pickupOverdue, orderBy: { pickupAt: "asc" }, take: LIMIT, select: LOAD_ROW }),
          db.load.count({ where: pickupOverdue }),
          db.load.findMany({ where: unassigned, orderBy: { pickupAt: "asc" }, take: LIMIT, select: LOAD_ROW }),
          db.load.count({ where: unassigned }),
        ]);
        const runningLate = lateRows
          .map((l) => ({ l, x: byId.get(l.id)! }))
          .sort((a, b) => b.x.hoursLate - a.x.hoursLate)
          .map(({ l, x }) => ({ ...loadView(l, view), eta: fmtDateTime(x.eta), hoursLate: x.hoursLate, overdueNotDelivered: x.overdueNotDelivered, progressPct: round(loadProgress(l, now) * 100) }));
        return {
          asOf: fmtDateTime(new Date(now)),
          runningLate: { total: late.length, showing: runningLate.length, truncated: late.length > runningLate.length, loads: runningLate },
          pickupOverdue: { total: assignedTotal, showing: assigned.length, truncated: assignedTotal > assigned.length, loads: assigned.map((l) => ({ ...loadView(l, view), hoursPastPickup: round((now - l.pickupAt.getTime()) / HOUR, 1) })) },
          unassignedWithin24h: { total: plannedTotal, showing: planned.length, truncated: plannedTotal > planned.length, loads: planned.map((l) => ({ ...loadView(l, view), hoursToPickup: round((l.pickupAt.getTime() - now) / HOUR, 1) })) },
          note: "ETA is a route estimate at ~58 km/h average from departure. overdueNotDelivered = the delivery time has passed and the load is still in transit.",
        };
      }),
    }),

    loadsByStatus: tool({
      description: "Loads in one status with totals (count, km and, when permitted, revenue). Statuses: PLANNED (booked, not yet dispatched), ASSIGNED (dispatched), IN_TRANSIT, DELIVERED (not yet invoiced), INVOICED, CANCELLED, TONU (truck ordered, not used). Upcoming statuses sort soonest pickup first; finished ones most recent first.",
      inputSchema: z.object({
        status: z.enum(LOAD_STATUSES),
        customer: filterText("Customer or broker name (case-insensitive contains)"),
        days: z.number().int().min(1).max(365).optional().describe("Only loads with pickup in the last N days (default: all)"),
      }),
      execute: (f) => safely("loadsByStatus", async () => {
        const upcoming = f.status === "PLANNED" || f.status === "ASSIGNED" || f.status === "IN_TRANSIT";
        const where: Prisma.LoadWhereInput = {
          status: f.status,
          ...(f.customer ? { OR: [{ customer: { name: like(f.customer) } }, { broker: { name: like(f.customer) } }] } : {}),
          ...(f.days ? { pickupAt: { gte: new Date(Date.now() - f.days * DAY) } } : {}),
        };
        const [rows, agg] = await Promise.all([
          db.load.findMany({ where, orderBy: { pickupAt: upcoming ? "asc" : "desc" }, take: LIMIT, select: LOAD_ROW }),
          db.load.aggregate({ where, _count: true, _sum: { rate: true, distanceKm: true } }),
        ]);
        return {
          status: loadLabel(f.status), filters: f,
          total: agg._count, showing: rows.length, truncated: agg._count > rows.length,
          totalKm: round(agg._sum.distanceKm ?? 0), ...(access.loads ? { totalRateUsd: round(agg._sum.rate ?? 0) } : {}),
          loads: rows.map((l) => loadView(l, view)),
        };
      }),
    }),

    findLoad: tool({
      description: "Open one load by its reference (e.g. LD-10012) or customer reference number. Returns route, stops with arrival status, assignment, documents on file, billing stage, recent activity and (when permitted) money. If several match, returns the candidates instead.",
      inputSchema: z.object({ reference: queryText("Load reference like LD-10012, or a customer / broker reference number") }),
      execute: ({ reference: q }) => safely("findLoad", async () => {
        let hits = await db.load.findMany({ where: { OR: [{ reference: { equals: q, mode: "insensitive" } }, { customerRef: { equals: q, mode: "insensitive" } }] }, select: { id: true }, take: 2 });
        if (hits.length !== 1) hits = await db.load.findMany({ where: { OR: [{ reference: like(q) }, { customerRef: like(q) }] }, select: { id: true }, take: 6, orderBy: { pickupAt: "desc" } });
        if (hits.length === 0) return { found: false, message: `No load matches "${q}". Check the reference or try searchEverything.` };
        if (hits.length > 1) {
          const rows = await db.load.findMany({ where: { id: { in: hits.map((h) => h.id) } }, select: LOAD_ROW, orderBy: { pickupAt: "desc" } });
          return { found: false, candidates: rows.map((l) => ({ reference: l.reference, customerRef: l.customerRef, status: loadLabel(l.status), route: `${l.originCity} → ${l.destCity}`, pickupAt: fmtDateTime(l.pickupAt), href: link(`/loads/${l.id}`) })) };
        }
        const l = await db.load.findUniqueOrThrow({
          where: { id: hits[0].id },
          select: {
            ...LOAD_ROW, notes: true, podSignedBy: true, driverPay: true, fuelCost: true, otherCost: true, temperatureC: true, pallets: true,
            stops: { orderBy: { seq: "asc" }, select: { seq: true, type: true, name: true, city: true, windowStart: true, windowEnd: true, status: true, arrivedAt: true, departedAt: true } },
            events: { orderBy: { createdAt: "desc" }, take: 8, select: { type: true, message: true, createdAt: true, user: { select: { name: true } } } },
            invoice: { select: { id: true, number: true, status: true, amount: true, taxRate: true, dueAt: true, paidAt: true } },
            claims: { select: { id: true, number: true, status: true, type: true } },
            dispatcher: { select: { name: true } },
          },
        });
        const now = Date.now();
        const inTransit = l.status === "IN_TRANSIT";
        const timing = inTransit ? lateness(l, now) : null;
        const cost = l.driverPay + l.fuelCost + l.otherCost;
        return {
          found: true,
          ...loadView(l, view),
          origin: l.originName, destination: l.destName, dispatcher: l.dispatcher?.name ?? null, pallets: l.pallets, temperatureC: l.temperatureC, notes: l.notes, podSignedBy: l.podSignedBy,
          progressPct: inTransit ? round(loadProgress(l, now) * 100) : null, eta: fmtDateTime(timing?.eta),
          runningLate: timing?.late ?? false, hoursLate: timing?.hoursLate ?? 0, overdueNotDelivered: timing?.overdueNotDelivered ?? false,
          documentsOnFile: l.documents.map((x) => x.kind), missingBillingDocs: missingLoadDocs(l.documents),
          stops: l.stops.map((s) => ({ seq: s.seq, type: humanize(s.type), name: s.name, city: s.city, window: [fmtDateTime(s.windowStart), fmtDateTime(s.windowEnd)].filter(Boolean).join(" – ") || null, status: humanize(s.status), arrivedAt: fmtDateTime(s.arrivedAt), departedAt: fmtDateTime(s.departedAt) })),
          recentActivity: l.events.map((e) => ({ at: fmtDateTime(e.createdAt), type: humanize(e.type), message: e.message, by: e.user?.name ?? "system" })),
          claims: l.claims.map((c) => ({ number: c.number, type: label(CLAIM_TYPE_LABELS, c.type), status: humanize(c.status), href: link(`/claims/${c.id}`) })),
          // Same audience as the load page's Financials card (finance.view or loads.edit); the invoice page itself is finance-only.
          ...(access.loads
            ? {
                money: {
                  rateUsd: round(l.rate), driverPayUsd: round(l.driverPay), fuelCostUsd: round(l.fuelCost), otherCostUsd: round(l.otherCost), marginUsd: round(l.rate - cost),
                  marginPct: l.rate ? round(((l.rate - cost) / l.rate) * 100) : null,
                  invoice: l.invoice ? { number: l.invoice.number, status: humanize(l.invoice.status), totalUsd: round(l.invoice.amount * (1 + l.invoice.taxRate)), dueAt: fmtDate(l.invoice.dueAt), paidAt: fmtDate(l.invoice.paidAt), href: link(`/finance/invoices/${l.invoice.id}`) } : null,
                },
              }
            : {}),
        };
      }),
    }),

    billingQueue: tool({
      description: "Finance: delivered loads not yet invoiced, split into 'ready to invoice' (RC and POD on file) and 'missing docs' (what is missing), each with count, total and up to 25 loads, oldest delivery first. Answers 'what can we invoice today'.",
      inputSchema: z.object({}),
      execute: () => safely("billingQueue", async () => {
        const order: Prisma.LoadOrderByWithRelationInput[] = [{ deliveredAt: "asc" }, { deliveryAt: "asc" }];
        const [totals, readyRows, missingRows] = await Promise.all([
          db.load.groupBy({ by: ["billingStage"], where: { billingStage: { in: ["READY_TO_INVOICE", "MISSING_DOCS"] } }, _count: true, _sum: { rate: true } }),
          db.load.findMany({ where: { billingStage: "READY_TO_INVOICE" }, orderBy: order, take: LIMIT, select: BILLING_ROW }),
          db.load.findMany({ where: { billingStage: "MISSING_DOCS" }, orderBy: order, take: LIMIT, select: BILLING_ROW }),
        ]);
        const now = Date.now();
        const row = (l: Prisma.LoadGetPayload<{ select: typeof BILLING_ROW }>) => ({
          reference: l.reference, href: link(`/loads/${l.id}`), customer: l.customer.name, billTo: l.broker?.name ?? l.customer.name, route: `${l.originCity} → ${l.destCity}`,
          deliveredAt: fmtDateTime(l.deliveredAt ?? l.deliveryAt), daysSinceDelivery: daysSince(l.deliveredAt ?? l.deliveryAt, now), rateUsd: round(l.rate), status: loadLabel(l.status),
          missingDocs: missingLoadDocs(l.documents),
        });
        const stage = (key: string, rows: Prisma.LoadGetPayload<{ select: typeof BILLING_ROW }>[]) => {
          const t = totals.find((x) => x.billingStage === key);
          const count = t?._count ?? 0;
          return { count, totalUsd: round(t?._sum.rate ?? 0), showing: rows.length, truncated: count > rows.length, loads: rows.map(row) };
        };
        return {
          asOf: fmtDateTime(new Date(now)),
          readyToInvoice: stage("READY_TO_INVOICE", readyRows),
          missingDocs: stage("MISSING_DOCS", missingRows),
          href: link("/finance?tab=queue"),
          note: "Invoices are raised from the load page or the finance queue; brokers are billed instead of shippers when a broker is on the load.",
        };
      }),
    }),

    receivables: tool({
      description: "Finance: open receivables (sent invoices) with ageing buckets (current, 1–30, 31–60, 60+ days late), totals incl. VAT, and the most overdue invoices with customer and days late.",
      inputSchema: z.object({}),
      execute: () => safely("receivables", async () => {
        const now = Date.now();
        const [aging, open, drafts] = await Promise.all([
          receivablesAging(),
          db.invoice.findMany({ where: { status: "SENT" }, orderBy: { dueAt: "asc" }, take: LIMIT, include: { customer: { select: { id: true, name: true } }, load: { select: { reference: true } } } }),
          db.invoice.count({ where: { status: "DRAFT" } }),
        ]);
        return {
          asOf: fmtDateTime(new Date(now)),
          openInvoices: aging.count, totalUsd: round(aging.total), overdueUsd: round(aging.overdue), draftInvoices: drafts,
          ageingUsd: Object.fromEntries(Object.entries(aging.aging).map(([k, v]) => [k, round(v)])),
          invoices: open.map((i) => {
            const late = Math.floor((now - i.dueAt.getTime()) / DAY);
            return { number: i.number, href: link(`/finance/invoices/${i.id}`), customer: i.customer.name, customerHref: link(`/customers/${i.customer.id}`), load: i.load?.reference ?? null, totalUsd: round(i.amount * (1 + i.taxRate)), issuedAt: fmtDate(i.issuedAt), dueAt: fmtDate(i.dueAt), daysLate: Math.max(0, late), overdue: late > 0 };
          }),
          showing: open.length, truncated: aging.count > open.length, href: link("/finance?tab=aging"),
        };
      }),
    }),

    openClaims: tool({
      description: "Open claims (reported, under review, docs collected, submitted, negotiation, disputed, litigation): number, type, severity, status, days open, fault, amount claimed, driver, load, unit. Oldest first.",
      inputSchema: z.object({ severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional() }),
      execute: (f) => safely("openClaims", async () => {
        const now = Date.now();
        const where: Prisma.ClaimWhereInput = { status: { in: [...CLAIM_OPEN_STATUSES] }, ...(f.severity ? { severity: f.severity } : {}) };
        const [rows, total, sum] = await Promise.all([
          db.claim.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, include: { driver: { select: { name: true } }, load: { select: { reference: true } }, truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } }, customer: { select: { name: true } }, assignedTo: { select: { name: true } } } }),
          db.claim.count({ where }),
          db.claim.aggregate({ where, _sum: { amountClaimed: true } }),
        ]);
        // Claim amounts are shown on /claims to everyone with claims.view, this tool's own permission.
        return {
          total, showing: rows.length, truncated: total > rows.length, totalClaimedUsd: round(sum._sum.amountClaimed ?? 0),
          claims: rows.map((c) => ({
            number: c.number, href: link(`/claims/${c.id}`), type: label(CLAIM_TYPE_LABELS, c.type), severity: humanize(c.severity), status: humanize(c.status),
            incidentAt: fmtDate(c.incidentAt), daysOpen: daysSince(c.createdAt, now), fault: label(CLAIM_FAULT_LABELS, c.fault), amountClaimedUsd: round(c.amountClaimed),
            driver: c.driver?.name ?? null, load: c.load?.reference ?? null, unit: c.truck?.unitNumber ?? c.trailer?.unitNumber ?? null, customer: c.customer?.name ?? null, assignedTo: c.assignedTo?.name ?? null,
            location: c.location, summary: c.description.length > 160 ? `${c.description.slice(0, 157)}…` : c.description,
          })),
        };
      }),
    }),

    maintenanceDue: tool({
      description: "Trucks due or overdue for service by odometer (next service km minus current km), most urgent first, plus units in the shop now with their work orders (#number). withinKm defaults to 2000.",
      inputSchema: z.object({ withinKm: z.number().int().min(0).max(100_000).optional().describe("Include trucks with service due inside this many km (default 2000). Overdue trucks are always included.") }),
      execute: ({ withinKm }) => safely("maintenanceDue", async () => {
        const horizon = withinKm ?? PM_DUE_SOON_KM;
        const now = Date.now();
        const [trucks, inShop, inShopTotal, notStarted] = await Promise.all([
          // Service due is odometer arithmetic, so it is checked in memory over a bounded scan of light rows.
          db.truck.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" }, take: SCAN, select: SERVICE_ROW }),
          db.workOrder.findMany({ where: { status: "IN_PROGRESS" }, orderBy: { inAt: "asc" }, take: LIMIT, include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } } } }),
          db.workOrder.count({ where: { status: "IN_PROGRESS" } }),
          db.workOrder.count({ where: { status: { in: ["OPEN", "DRAFT"] } } }),
        ]);
        const due = trucks
          .map((t) => ({ t, pm: pmStatus(t) }))
          .filter(({ pm }) => pm.kmLeft != null && pm.kmLeft < horizon)
          .sort((a, b) => (a.pm.kmLeft ?? 0) - (b.pm.kmLeft ?? 0))
          .map(({ t, pm }) => ({
            unit: t.unitNumber, href: link(`/fleet/${t.id}`), vehicle: `${t.year} ${t.make} ${t.model}`, status: truckStatusLabel(t.status), driver: t.driver?.name ?? null,
            odometerKm: t.odometerKm, nextServiceKm: pm.nextServiceKm, kmLeft: pm.kmLeft, state: pm.state, lastPmAt: fmtDate(t.lastPmAt), currentLoad: t.loads[0]?.reference ?? null, location: t.locationName,
          }));
        return {
          withinKm: horizon, overdue: due.filter((t) => t.state === "overdue").length, dueSoon: due.filter((t) => t.state === "due soon").length,
          noServiceData: trucks.filter((t) => pmStatus(t).state === "unknown").length,
          ...capped(due, "trucks"),
          ...(trucks.length === SCAN ? { scanLimit: `checked the first ${SCAN} trucks only` } : {}),
          inShopTotal,
          inShop: inShop.map((w) => ({
            workOrder: `#${w.number}`, href: link(`/maintenance/work-orders/${w.id}`), title: w.title,
            unit: w.truck?.unitNumber ?? w.trailer?.unitNumber ?? null, unitHref: w.truck ? link(`/fleet/${w.truck.id}`) : w.trailer ? link(`/fleet/trailers/${w.trailer.id}`) : undefined,
            category: label(WORK_ORDER_CATEGORY_LABELS, w.category), priority: humanize(w.priority), vendor: w.vendor, inShopSince: fmtDate(w.inAt ?? w.scheduledAt), daysInShop: daysSince(w.inAt ?? w.scheduledAt, now),
          })),
          openWorkOrdersNotStarted: notStarted, href: link("/maintenance/work-orders"),
        };
      }),
    }),

    weeklyProduction: tool({
      description: "Weekly production board: revenue, km and revenue per km per team and per driver for one week (Monday start), against weekly goals, with efficiency % (= revenue / goal). Defaults to the current week. Loads count on their pickup day.",
      inputSchema: z.object({ weekStart: z.string().max(40).optional().describe("Any date inside the week, YYYY-MM-DD. Defaults to today.") }),
      execute: ({ weekStart }) => safely("weeklyProduction", async () => {
        const anchor = weekStart && !Number.isNaN(Date.parse(weekStart)) ? new Date(weekStart) : new Date();
        // Revenue here is what /dispatch/weekly shows to everyone with loads.view, this tool's own permission.
        const w = await weeklyProduction(startOfWeek(anchor, { weekStartsOn: 1 }));
        const drivers = w.groups.flatMap((g) => g.rows.map((r) => ({
          driver: r.driver.name, href: link(`/drivers/${r.driver.id}`), team: g.team.name, type: label(DRIVER_TYPE_LABELS, r.driver.type), truck: r.driver.truck, hold: r.driver.hold,
          revenueUsd: round(r.total), km: round(r.km), revenuePerKm: r.rpk, goalUsd: r.goal, vsGoalUsd: round(r.planDelta), efficiencyPct: r.efficiency, daysWorked: r.daysWorked, loads: r.days.reduce((a, c) => a + c.loads.length, 0),
        }))).sort((a, b) => b.revenueUsd - a.revenueUsd);
        return {
          week: `${fmtDate(w.start)} – ${fmtDate(new Date(w.end.getTime() - DAY))}`, goalsUsd: { soloCompanyDriver: w.goals.solo, ownerOrLeaseOperator: w.goals.team },
          fleetTotals: { revenueUsd: round(w.grand.total), km: round(w.grand.km), drivers: w.grand.drivers, avgPerTruckUsd: w.grand.avgPerTruck, revenuePerKm: w.grand.rpk },
          teams: w.groups.map((g) => ({ team: g.team.name, drivers: g.rows.length, revenueUsd: round(g.total), km: round(g.km), avgPerTruckUsd: g.avgPerTruck, efficiencyPct: g.efficiency })),
          belowGoal: drivers.filter((x) => x.vsGoalUsd < 0).length,
          ...capped(drivers, "drivers"), href: link("/dispatch/weekly"),
        };
      }),
    }),

    alerts: tool({
      description: "Operational alerts that need a human, critical first: compliance (expiring licences, insurance, inspections, missing paperwork), dispatch (late or unassigned loads, idle drivers), fleet (service due, trailers stuck in shop), money (overdue invoices, no rate confirmation, lease caps) and safety (old open claims). Only alerts this role can open are returned.",
      inputSchema: z.object({ kind: z.enum(["compliance", "dispatch", "fleet", "money", "safety"]).optional(), level: z.enum(["critical", "warning"]).optional() }),
      execute: (f) => safely("alerts", async () => {
        const all = await getAlerts();
        // Same rule as the alerts bell and "Needs attention": only alerts this role can open (invoice alerts stay with finance).
        const visible = all.filter((a) => canOpen(ctx.role, a.href) && (!f.kind || a.kind === f.kind) && (!f.level || a.level === f.level));
        const by = <K extends string>(key: (a: (typeof all)[number]) => K) => visible.reduce<Record<string, number>>((m, a) => { m[key(a)] = (m[key(a)] ?? 0) + 1; return m; }, {});
        return { asOf: fmtDateTime(new Date()), byLevel: by((a) => a.level), byKind: by((a) => a.kind), ...capped(visible, "alerts"), href: "/dashboard/alerts" };
      }),
    }),

    searchEverything: tool({
      description: "Free-text search across loads, drivers, trucks, trailers, customers and (when permitted) invoices — by reference, name, unit number, plate, city or commodity. Use when you do not know what kind of thing the user means. Up to 5 hits per type.",
      inputSchema: z.object({ q: queryText("Search text, at least 2 characters") }),
      execute: ({ q: t }) => safely("searchEverything", async () => {
        const [loads, drivers, trucks, trailers, customers, invoices] = await Promise.all([
          can(ctx.role, "loads.view") ? db.load.findMany({ where: { OR: [{ reference: like(t) }, { customerRef: like(t) }, { originCity: like(t) }, { destCity: like(t) }, { commodity: like(t) }, { customer: { name: like(t) } }] }, take: 5, orderBy: { pickupAt: "desc" }, select: LOAD_ROW }) : [],
          can(ctx.role, "drivers.view") ? db.driver.findMany({ where: { OR: [{ name: like(t) }, { phone: like(t) }] }, take: 5, select: { id: true, name: true, phone: true, status: true, boardStatus: true, hold: true, truck: { select: { unitNumber: true } } } }) : [],
          can(ctx.role, "fleet.view") ? db.truck.findMany({ where: { OR: [{ unitNumber: like(t) }, { plate: like(t) }, { make: like(t) }, { model: like(t) }, { locationName: like(t) }] }, take: 5, select: { id: true, unitNumber: true, make: true, model: true, status: true, locationName: true, driver: { select: { name: true } } } }) : [],
          can(ctx.role, "fleet.view") ? db.trailer.findMany({ where: { OR: [{ unitNumber: like(t) }, { plate: like(t) }] }, take: 5, select: { id: true, unitNumber: true, type: true, status: true, locationName: true, truck: { select: { unitNumber: true } } } }) : [],
          can(ctx.role, "customers.view") ? db.customer.findMany({ where: { OR: [{ name: like(t) }, { contactName: like(t) }, { city: like(t) }] }, take: 5, select: { id: true, name: true, kind: true, contactName: true, phone: true, city: true, paymentTerms: true } }) : [],
          access.finance ? db.invoice.findMany({ where: { OR: [{ number: like(t) }, { customer: { name: like(t) } }] }, take: 5, include: { customer: { select: { name: true } } } }) : [],
        ]);
        return {
          query: t,
          loads: loads.map((l) => ({ reference: l.reference, status: loadLabel(l.status), customer: l.customer.name, route: `${l.originCity} → ${l.destCity}`, pickupAt: fmtDateTime(l.pickupAt), driver: l.driver?.name ?? null, truck: l.truck?.unitNumber ?? null, href: link(`/loads/${l.id}`) })),
          drivers: drivers.map((x) => ({ name: x.name, phone: x.phone, employment: humanize(x.status), boardStatus: boardLabel(x.boardStatus), hold: x.hold, truck: x.truck?.unitNumber ?? null, href: link(`/drivers/${x.id}`) })),
          trucks: trucks.map((x) => ({ unit: x.unitNumber, vehicle: `${x.make} ${x.model}`, status: truckStatusLabel(x.status), driver: x.driver?.name ?? null, location: x.locationName, href: link(`/fleet/${x.id}`) })),
          trailers: trailers.map((x) => ({ unit: x.unitNumber, type: humanize(x.type), status: label(TRAILER_STATUS_LABELS, x.status), pairedTruck: x.truck?.unitNumber ?? null, location: x.locationName, href: link(`/fleet/trailers/${x.id}`) })),
          customers: customers.map((c) => ({ name: c.name, kind: humanize(c.kind), contact: c.contactName, phone: c.phone, city: c.city, paymentTermsDays: c.paymentTerms, href: link(`/customers/${c.id}`) })),
          invoices: invoices.map((i) => ({ number: i.number, customer: i.customer.name, status: humanize(i.status), totalUsd: round(i.amount * (1 + i.taxRate)), dueAt: fmtDate(i.dueAt), href: link(`/finance/invoices/${i.id}`) })),
        };
      }),
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
