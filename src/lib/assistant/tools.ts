import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withCompany } from "@/lib/tenant";
import { kmDriven } from "@/lib/mileage";
import { can, type Permission } from "@/lib/permissions";
import { dateOnly, dayKey, fromZoned, zonedParts, type CompanyLocale } from "@/lib/locale";
import { OIL_DUE_NOW, OIL_DUE_SOON, SERVICE_STATE_LABELS, defectLabel, roLabel, serviceStatus, type ServiceState, type ServiceStatus } from "@/lib/service";
import { DOC_KIND_LABELS, REQUIRED_DRIVER_DOCS } from "@/lib/documents";
import {
  DEFECT_SEVERITIES, DEFECT_SEVERITY_LABELS, DEFECT_STATUS_LABELS, DRIVER_STATUSES, DRIVER_TYPES, DRIVER_TYPE_LABELS, EQUIPMENT, EQUIPMENT_LABELS,
  INSPECTION_LEVEL_LABELS, OWNERSHIP, OWNERSHIP_LABELS, PAYERS, PAYER_LABELS, PAYMENT_STATUS_LABELS, PTI_COMPONENT_LABELS, REPAIR_STAGES,
  REPAIR_STAGE_LABELS, REPAIR_SYSTEM_LABELS, REPAIR_TYPES, REPAIR_TYPE_LABELS, ROADSIDE_RESULTS, ROADSIDE_RESULT_LABELS, ROADSIDE_STATUSES,
  ROADSIDE_STATUS_LABELS, TRAILER_STATUSES, TRAILER_STATUS_LABELS, TRUCK_STATUSES, VENDOR_TYPES, VENDOR_TYPE_LABELS, WORK_ORDER_PRIORITIES, humanize,
} from "@/lib/constants";
import { TRAILER_POSITION_FIELDS, TRUCK_POSITION_FIELDS, lastSeen } from "./motion";
import { COSTS_HIDDEN, DAY_MS as DAY, daysSince, daysUntil, makeKit, round, sumOf, type Kit } from "./kit";
import {
  EXPIRY_SOON_DAYS, SCAN, docIndex, emptyIndex, loadPaperwork, paperView, papersMatch, trailerPapers, truckPapers, type DocIndex, type HolderType,
} from "./paperwork";

/*
 * Read-only lookups for the fleet assistant. Every query goes through the company-scoped `db`, and every tool runs
 * pinned to the company the request was authorised for (withCompany), so a tool can only ever see that company.
 * Every figure leaves here already formatted in the company's units, time zone and currency (makeFormat), and costs,
 * invoices and spend only ever leave for roles with money.view.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Hard cap on list sizes handed to the model. */
export const LIMIT = 25;
/** A leased truck this close (company distance unit) to its hard cap is "near cap" (same rule as the truck page). */
const LEASE_NEAR = 5000;
/** Repair order states that still need doing; DRAFT and OPEN have not started yet. */
const ACTIVE_WO = ["DRAFT", "OPEN", "IN_PROGRESS"];
const NOT_STARTED_WO = ["DRAFT", "OPEN"];
const LIVE_WO: Prisma.WorkOrderWhereInput = { voidedAt: null, status: { not: "CANCELLED" } };
const SEVERITY_RANK: Record<string, number> = { NOW: 0, SOON: 1, WATCH: 2 };

const like = (q: string) => ({ contains: q, mode: "insensitive" as const });
const exact = (q: string) => ({ equals: q, mode: "insensitive" as const });
const truckStatusLabel = (s: string) => (s === "MAINTENANCE" ? "In maintenance" : s === "VENDOR" ? "At a vendor" : humanize(s));
const RO_STATUS: Record<string, string> = { DRAFT: "Draft", OPEN: "Scheduled", IN_PROGRESS: "In the shop", DONE: "Completed", CANCELLED: "Cancelled" };
/** What a repair order cost: its cost, or the invoice total when no cost was entered (same rule as Reports). */
const roAmount = (w: { cost: number; invoiceTotal: number | null }) => (w.cost > 0 ? w.cost : (w.invoiceTotal ?? 0));
const componentLabel = (c: string) => PTI_COMPONENT_LABELS[c] ?? humanize(c);

/** Control characters (NUL and friends) break Postgres text queries and have no place in a search. */
const printable = (s: string) => [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
/** Required free text (a unit number or a search): trimmed before the length check, printable only. */
const queryText = (desc: string) => z.string().trim().min(1).max(80).refine(printable, "Use printable characters only").describe(desc);
/** Optional free-text filter: trimmed; empty means no filter. */
const filterText = (desc: string) => z.string().trim().max(80).refine(printable, "Use printable characters only").optional().describe(desc);
const dateText = (desc: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().describe(desc);

/** Cap a list and say so, so the model can tell the user "showing 25 of 61". */
function capped<T>(rows: T[], key: string) {
  return { total: rows.length, showing: Math.min(LIMIT, rows.length), truncated: rows.length > LIMIT, [key]: rows.slice(0, LIMIT) };
}

/** What the model gets when a lookup throws: no stack, no SQL, no file paths (the real error goes to the server log). */
const LOOKUP_FAILED = { error: "That lookup failed. Ask the user to try again." } as const;

/* ------------------------------------------------------------------ */
/* Fleet rules (same as the fleet, shop and inspection pages)          */
/* ------------------------------------------------------------------ */

const SERVICE_FIELDS = {
  odometerKm: true, odometerAt: true, pmIntervalKm: true, lastPmKm: true, lastPmAt: true, nextServiceKm: true,
  truckType: { select: { name: true, oilIntervalKm: true } },
} satisfies Prisma.TruckSelect;
type ServiceRow = Prisma.TruckGetPayload<{ select: typeof SERVICE_FIELDS }>;

type OilFilter = "overdue" | "due_now" | "due_soon" | "due" | "no_reading" | "unknown";
const oilMatches = (s: ServiceState, filter: OilFilter) =>
  filter === "due" ? s === "overdue" || s === "due_now" || s === "due_soon" : s === filter;

/** Oil change / PM by odometer (src/lib/service.ts), worded with the company's distance unit. */
function oilView(t: { lastPmAt: Date | null }, s: ServiceStatus, kit: Kit) {
  const { f } = kit;
  return {
    state: SERVICE_STATE_LABELS[s.state],
    interval: `${f.dist(s.interval)} (${s.intervalFrom ? `truck type ${s.intervalFrom}` : "the truck's own interval"})`,
    lastChange: s.lastKm != null ? `at ${f.dist(s.lastKm)}${t.lastPmAt ? ` on ${f.date(t.lastPmAt)}` : ""}` : null,
    dueAt: s.dueAtKm != null ? f.dist(s.dueAtKm) : null,
    used: s.used != null ? `${s.stale ? "at least " : ""}${f.dist(s.used)}${s.stale && s.readingAt ? ` as of ${f.date(s.readingAt)}` : ""}` : null,
    left: s.left == null ? null : s.left < 0 ? `${s.stale ? "at least " : ""}${f.dist(-s.left)} over` : `${s.stale ? "at most " : ""}${f.dist(s.left)} left`,
    odometerReading: s.readingAt ? `read ${f.date(s.readingAt)}${s.stale ? " (older than two weeks, so the figures are bounds)" : ""}` : "no reading date",
  };
}

const LEASE_FIELDS = {
  ownership: true, lessor: true, odometerKm: true, leaseStartKm: true, leaseAnnualLimitKm: true, leaseBufferPct: true, leaseOverageRate: true,
} satisfies Prisma.TruckSelect;
type LeaseInput = {
  ownership: string; lessor: string | null; odometerKm: number;
  leaseStartKm: number | null; leaseAnnualLimitKm: number | null; leaseBufferPct: number | null; leaseOverageRate: number | null;
};
type LeaseState = "over cap" | "in buffer" | "near cap" | "ok";

/** Hard cap = lease start + annual limit × (1 + buffer). Every unit of distance past it costs the overage rate. */
function leaseNumbers(t: LeaseInput) {
  if (t.ownership !== "LEASED" || !t.leaseAnnualLimitKm) return null;
  const startKm = t.leaseStartKm ?? 0;
  const bufferPct = t.leaseBufferPct ?? 0;
  const allowed = startKm + t.leaseAnnualLimitKm;
  const hardCap = startKm + Math.round(t.leaseAnnualLimitKm * (1 + bufferPct / 100));
  const remaining = hardCap - t.odometerKm;
  const over = Math.max(0, -remaining);
  const state: LeaseState = over > 0 ? "over cap" : t.odometerKm > allowed ? "in buffer" : remaining < LEASE_NEAR ? "near cap" : "ok";
  return { state, startKm, bufferPct, allowed, hardCap, remaining, over };
}

function leaseView(t: LeaseInput, kit: Kit) {
  const n = leaseNumbers(t);
  if (!n) return null;
  const { f, L } = kit;
  return {
    state: n.state, lessor: t.lessor, start: f.dist(n.startKm), annualLimit: f.dist(t.leaseAnnualLimitKm), bufferPct: n.bufferPct,
    allowedUpTo: f.dist(n.allowed), hardCap: f.dist(n.hardCap), used: f.dist(Math.max(0, t.odometerKm - n.startKm)),
    remaining: n.remaining >= 0 ? f.dist(n.remaining) : `${f.dist(n.over)} over the cap`,
    ...kit.cash({ overageRate: t.leaseOverageRate != null ? `${f.money2(t.leaseOverageRate)} ${L.perDistance}` : null, overageSoFar: f.money(n.over * (t.leaseOverageRate ?? 0)) }),
  };
}

type RiskInput = { score: number; licenseExpiry: Date; medicalExpiry: Date | null };
/** Same rule as the drivers page: score under 75, or licence / medical expired or expiring within 30 days. */
function riskReasons(dr: RiskInput, now: number) {
  const out: string[] = [];
  if (dr.score < 75) out.push(`safety score ${dr.score}`);
  const lic = daysUntil(dr.licenseExpiry, now)!;
  if (lic < 0) out.push(`licence expired ${-lic}d ago`); else if (lic <= EXPIRY_SOON_DAYS) out.push(`licence expires in ${lic}d`);
  const med = daysUntil(dr.medicalExpiry, now);
  if (med == null) out.push("no medical date recorded");
  else if (med < 0) out.push(`medical expired ${-med}d ago`); else if (med <= EXPIRY_SOON_DAYS) out.push(`medical expires in ${med}d`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Row selects and views                                               */
/* ------------------------------------------------------------------ */

const UNIT_SELECT = { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } } } as const;
type UnitPair = { truck: { id: string; unitNumber: string } | null; trailer: { id: string; unitNumber: string } | null };
const unitView = (w: UnitPair, kit: Kit) =>
  w.truck ? { kind: "truck", unit: w.truck.unitNumber, href: kit.link(`/fleet/${w.truck.id}`) }
    : w.trailer ? { kind: "trailer", unit: w.trailer.unitNumber, href: kit.link(`/fleet/trailers/${w.trailer.id}`) } : null;

const TRUCK_ROW = {
  id: true, unitNumber: true, make: true, model: true, year: true, plate: true, vin: true, status: true, group: true, homeTerminal: true, inServiceAt: true,
  ...SERVICE_FIELDS, ...LEASE_FIELDS, ...TRUCK_POSITION_FIELDS,
  insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true,
  driver: { select: { id: true, name: true, phone: true, hold: true, holdReason: true, dispatcher: true } },
  trailers: { select: { id: true, unitNumber: true } },
  defects: { where: { status: { not: "CLOSED" } }, select: { holdsUnit: true } },
  _count: { select: { workOrders: { where: { status: { in: ACTIVE_WO }, voidedAt: null } } } },
} satisfies Prisma.TruckSelect;
type TruckRow = Prisma.TruckGetPayload<{ select: typeof TRUCK_ROW }>;

function truckView(t: TruckRow, docs: DocIndex, kit: Kit, now: number) {
  const { f, link, seesDrivers } = kit;
  const s = serviceStatus(t, new Date(now));
  return {
    unit: t.unitNumber, href: link(`/fleet/${t.id}`), vehicle: `${t.year} ${t.make} ${t.model}`, plate: t.plate, vin: t.vin,
    status: truckStatusLabel(t.status), ownership: kit.label(OWNERSHIP_LABELS, t.ownership), truckType: t.truckType?.name ?? null,
    group: t.group, homeTerminal: t.homeTerminal, inService: kit.date(t.inServiceAt),
    driver: t.driver
      ? seesDrivers
        ? { name: t.driver.name, phone: t.driver.phone, dispatcher: t.driver.dispatcher, onHold: t.driver.hold, holdReason: t.driver.hold ? (t.driver.holdReason ?? "no reason recorded") : null, href: link(`/drivers/${t.driver.id}`) }
        : "assigned"
      : null,
    trailers: t.trailers.map((x) => ({ unit: x.unitNumber, href: link(`/fleet/trailers/${x.id}`) })),
    odometer: f.dist(t.odometerKm), odometerAsOf: kit.date(t.odometerAt),
    oil: oilView(t, s, kit),
    paperwork: truckPapers(t, docs.get(t.id), now).map((p) => paperView(p, kit)),
    lease: leaseView(t, kit),
    lastSeen: lastSeen(t, kit, now),
    openRepairOrders: t._count.workOrders,
    openDefects: t.defects.length,
    defectsHoldingTruck: t.defects.filter((d) => d.holdsUnit).length,
  };
}

const TRAILER_ROW = {
  id: true, unitNumber: true, type: true, capacityKg: true, plate: true, year: true, status: true, statusSince: true,
  insuranceExpiry: true, inspectionExpiry: true, ...TRAILER_POSITION_FIELDS,
  truck: { select: { id: true, unitNumber: true } },
  defects: { where: { status: { not: "CLOSED" } }, select: { holdsUnit: true } },
  _count: { select: { workOrders: { where: { status: { in: ACTIVE_WO }, voidedAt: null } } } },
} satisfies Prisma.TrailerSelect;
type TrailerRow = Prisma.TrailerGetPayload<{ select: typeof TRAILER_ROW }>;

function trailerView(t: TrailerRow, docs: DocIndex, kit: Kit, now: number) {
  const { f, link } = kit;
  return {
    unit: t.unitNumber, href: link(`/fleet/trailers/${t.id}`), type: kit.label(EQUIPMENT_LABELS, t.type), capacity: f.weight(t.capacityKg), plate: t.plate, year: t.year,
    status: kit.label(TRAILER_STATUS_LABELS, t.status), since: kit.date(t.statusSince), daysInStatus: daysSince(t.statusSince, now),
    pairedTruck: t.truck ? { unit: t.truck.unitNumber, href: link(`/fleet/${t.truck.id}`) } : null,
    paperwork: trailerPapers(t, docs.get(t.id), now).map((p) => paperView(p, kit)),
    lastSeen: lastSeen(t, kit, now),
    openRepairOrders: t._count.workOrders,
    openDefects: t.defects.length,
  };
}

const WO_ROW = {
  id: true, number: true, title: true, repairType: true, priority: true, status: true, stage: true, stageAt: true, promisedAt: true,
  vendor: true, vendorRef: { select: { id: true, name: true } }, technician: true,
  payer: true, chargeDriver: { select: { id: true, name: true } }, driverInformedAt: true,
  invoiceNumber: true, invoiceTotal: true, paymentStatus: true, voidedAt: true, voidReason: true,
  scheduledAt: true, inAt: true, outAt: true, completedAt: true, odometerKm: true, odometerOutKm: true, cost: true,
  lines: { select: { system: true, work: true, amount: true }, orderBy: { position: "asc" } },
  ...UNIT_SELECT,
} satisfies Prisma.WorkOrderSelect;
type WoRow = Prisma.WorkOrderGetPayload<{ select: typeof WO_ROW }>;

/** `today`: start of today in company time; a draft / scheduled order dated before it that has not started is overdue. */
function woView(w: WoRow, kit: Kit, now: number, today: Date) {
  const { f, link, cash } = kit;
  const voided = w.voidedAt != null;
  const notStarted = !voided && NOT_STARTED_WO.includes(w.status);
  const overdueDays = notStarted && w.scheduledAt < today ? Math.ceil((today.getTime() - w.scheduledAt.getTime()) / DAY) : 0;
  const inShop = !voided && w.status === "IN_PROGRESS";
  const inSince = w.inAt ?? w.scheduledAt;
  const pastPromised = inShop && w.promisedAt && w.promisedAt.getTime() < now ? daysSince(w.promisedAt, now) : 0;
  return {
    repairOrder: roLabel(w.number), href: link(`/maintenance/work-orders/${w.id}`), title: w.title,
    unit: unitView(w, kit),
    type: kit.label(REPAIR_TYPE_LABELS, w.repairType),
    status: voided ? "Voided" : (RO_STATUS[w.status] ?? humanize(w.status)),
    ...(voided ? { voided: kit.date(w.voidedAt), voidReason: w.voidReason } : {}),
    ...(inShop && w.stage ? { stage: kit.label(REPAIR_STAGE_LABELS, w.stage), stageSince: kit.date(w.stageAt) } : {}),
    priority: humanize(w.priority),
    vendor: w.vendorRef ? { name: w.vendorRef.name, href: link(`/vendors/${w.vendorRef.id}`) } : w.vendor ? { name: w.vendor } : null,
    technician: w.technician,
    whoPays: kit.label(PAYER_LABELS, w.payer),
    ...(w.payer === "DRIVER"
      ? {
        chargedTo: w.chargeDriver ? (kit.seesDrivers ? { name: w.chargeDriver.name, href: link(`/drivers/${w.chargeDriver.id}`) } : "a driver") : "no driver picked yet",
        driverTold: w.driverInformedAt ? kit.date(w.driverInformedAt) : "not yet: nothing comes off the driver's pay until they are told",
      }
      : {}),
    scheduled: kit.date(w.scheduledAt),
    ...(overdueDays ? { overdueDays } : {}),
    ...(inShop ? { inShopSince: kit.dateTime(inSince), downtime: `${kit.span(now - inSince.getTime())} and counting` } : {}),
    ...(w.promisedAt && !w.completedAt && !voided ? { promisedBack: kit.date(w.promisedAt), ...(pastPromised ? { daysPastPromised: pastPromised } : {}) } : {}),
    ...(w.completedAt ? { completed: kit.date(w.completedAt), ...(w.inAt && w.outAt && w.outAt > w.inAt ? { downtime: kit.span(w.outAt.getTime() - w.inAt.getTime()) } : {}) } : {}),
    odometerIn: w.odometerKm != null ? f.dist(w.odometerKm) : null,
    ...(w.odometerOutKm != null ? { odometerOut: f.dist(w.odometerOutKm) } : {}),
    whatWasDone: w.lines.map((l) => ({ system: kit.label(REPAIR_SYSTEM_LABELS, l.system), work: l.work, ...cash({ amount: f.money2(l.amount) }) })),
    ...cash({
      cost: f.money(roAmount(w)),
      invoice: w.invoiceNumber || w.invoiceTotal != null
        ? { number: w.invoiceNumber, total: w.invoiceTotal != null ? f.money2(w.invoiceTotal) : null, payment: kit.label(PAYMENT_STATUS_LABELS, w.paymentStatus) }
        : "no invoice yet",
    }),
  };
}

const DEFECT_ROW = {
  id: true, number: true, truckId: true, trailerId: true, component: true, description: true, severity: true, status: true, holdsUnit: true,
  foundAt: true, dueAt: true, repairedAt: true, closedAt: true, closeNote: true,
  owner: { select: { name: true } }, closedBy: { select: { name: true } },
  workOrder: { select: { id: true, number: true, status: true } }, walkAround: { select: { weekStart: true } },
  ...UNIT_SELECT,
} satisfies Prisma.DefectSelect;
type DefectRow = Prisma.DefectGetPayload<{ select: typeof DEFECT_ROW }>;

function defectView(d: DefectRow, kit: Kit, now: number) {
  const { link } = kit;
  const open = d.status !== "CLOSED";
  const overdue = d.status === "OPEN" && d.dueAt && d.dueAt.getTime() < now ? daysSince(d.dueAt, now) : 0;
  return {
    defect: defectLabel(d.number), unit: unitView(d, kit), component: componentLabel(d.component), description: d.description,
    severity: kit.label(DEFECT_SEVERITY_LABELS, d.severity), status: kit.label(DEFECT_STATUS_LABELS, d.status),
    holdsTruckOutOfService: d.holdsUnit && open,
    found: kit.date(d.foundAt), ...(d.walkAround ? { foundOn: "weekly walk-around" } : {}),
    ...(open ? { openDays: daysSince(d.foundAt, now) } : {}),
    due: kit.date(d.dueAt), ...(overdue ? { daysPastDue: overdue } : {}),
    owner: d.owner?.name ?? null,
    repairOrder: d.workOrder ? { repairOrder: roLabel(d.workOrder.number), status: RO_STATUS[d.workOrder.status] ?? humanize(d.workOrder.status), href: link(`/maintenance/work-orders/${d.workOrder.id}`) } : null,
    ...(d.status === "REPAIRED" ? { repaired: kit.date(d.repairedAt), waiting: "someone must confirm the repair to close it" } : {}),
    ...(d.status === "CLOSED" ? { closed: kit.date(d.closedAt), closedBy: d.closedBy?.name ?? null, closeNote: d.closeNote } : {}),
  };
}
const defectOrder = (a: DefectRow, b: DefectRow) =>
  Number(b.holdsUnit) - Number(a.holdsUnit) || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.foundAt.getTime() - b.foundAt.getTime();

/* ------------------------------------------------------------------ */
/* Tool set                                                            */
/* ------------------------------------------------------------------ */

/** `companyId` is the company the request was authorised for; every tool runs pinned to it. `locale`: its units and time zone. */
export type ToolContext = { role: string; companyId: string; locale: CompanyLocale };

/** Which permission each tool needs. Tools the role cannot use are not offered to the model at all. */
export const TOOL_PERMISSION = {
  fleetOverview: "fleet.view",
  unitsDown: "fleet.view",
  listTrucks: "fleet.view",
  truckDetail: "fleet.view",
  listTrailers: "fleet.view",
  maintenanceDue: "fleet.view",
  workOrders: "fleet.view",
  vendors: "fleet.view",
  walkArounds: "fleet.view",
  defects: "fleet.view",
  roadsideInspections: "fleet.view",
  expiringPaperwork: "fleet.view",
  complianceGaps: "fleet.view",
  fleetCosts: "reports.view",
  listDrivers: "drivers.view",
  search: "fleet.view",
} as const satisfies Record<string, Permission>;
export type AssistantToolName = keyof typeof TOOL_PERMISSION;
const TOOL_NAMES = Object.keys(TOOL_PERMISSION) as AssistantToolName[];

export const allowedTools = (role: string) => TOOL_NAMES.filter((n) => can(role, TOOL_PERMISSION[n]));

const PAPERWORK_FILTER = z.enum(["expired", "expiring", "expired_or_expiring", "missing"]);
const WO_FILTERS = ["active", "overdue", "in_shop", "past_promised", "DRAFT", "OPEN", "IN_PROGRESS", "DONE", "CANCELLED", "voided", "all"] as const;
const OIL_FILTER = z.enum(["overdue", "due_now", "due_soon", "due", "no_reading", "unknown"]);

/**
 * Read-only tools, closed over the caller's role, company and locale: none of them writes to the database. Every tool
 * re-checks its permission (a mis-routed call never leaks data, even though disallowed tools are not offered to the
 * model), runs pinned to the authorised company and contains its own errors.
 */
export function buildAssistantTools(ctx: ToolContext) {
  const kit = makeKit(ctx);
  const { f, L, link, seesDrivers, seesMoney, cash } = kit;
  const costsNote = seesMoney ? {} : { costsHidden: COSTS_HIDDEN };

  /** Permission re-check, company pin and error containment: a thrown error is logged here and never reaches the model. */
  async function safely<T>(name: AssistantToolName, run: () => Promise<T>) {
    if (!can(ctx.role, TOOL_PERMISSION[name])) return { error: `Your role cannot use ${name}. Say that this information is not available to you.` };
    try {
      return await withCompany(ctx.companyId, run);
    } catch (error) {
      console.error(`[assistant] tool ${name} failed`, error);
      return LOOKUP_FAILED;
    }
  }

  /** Trucks and trailers whose unit number matches `q` (exact first, then contains). */
  async function findUnits(q: string) {
    const [trucks, trailers] = await Promise.all([
      db.truck.findMany({ where: { unitNumber: exact(q) }, select: { id: true, unitNumber: true }, take: 5 }),
      db.trailer.findMany({ where: { unitNumber: exact(q) }, select: { id: true, unitNumber: true }, take: 5 }),
    ]);
    if (trucks.length || trailers.length) return { trucks, trailers };
    const [t2, r2] = await Promise.all([
      db.truck.findMany({ where: { unitNumber: like(q) }, select: { id: true, unitNumber: true }, take: 5 }),
      db.trailer.findMany({ where: { unitNumber: like(q) }, select: { id: true, unitNumber: true }, take: 5 }),
    ]);
    return { trucks: t2, trailers: r2 };
  }
  const unitWhere = (ids: string[]) => ({ OR: [{ truckId: { in: ids } }, { trailerId: { in: ids } }] });

  /** End of the company week that starts at `start` (its last millisecond). */
  const weekEnd = (start: Date) => new Date(f.startOfDay(new Date(start.getTime() + 7 * DAY + 6 * 3_600_000)).getTime() - 1);

  return {
    fleetOverview: tool({
      description: "Fleet snapshot right now: trucks by status and units down, oil / PM overdue or due, leased trucks near their mileage cap, trailers by status, drivers working / on hold / with licence or medical problems, repair orders by state and stage (in the shop, past the promised date, scheduled overdue), driver charges not told, open defects and those holding a truck, this week's walk-around videos, open roadside corrections, and paperwork expired or expiring within 30 days. Use first for 'how is the fleet doing' or 'what needs attention'; then use the specific tool to name the units.",
      inputSchema: z.object({}),
      execute: () => safely("fleetOverview", async () => {
        const now = Date.now();
        const today = f.startOfDay(new Date(now));
        const soon = new Date(now + EXPIRY_SOON_DAYS * DAY);
        const week = f.weekStart(new Date(now));
        const [byStatus, trucks, trailersByStatus, drivers, woByState, woOverdue, inShop, paperwork, defects, walks, untold, corrections] = await Promise.all([
          db.truck.groupBy({ by: ["status"], _count: true }),
          db.truck.findMany({ where: { status: { not: "INACTIVE" } }, take: SCAN, select: { id: true, status: true, driverId: true, ...SERVICE_FIELDS, ...LEASE_FIELDS } }),
          db.trailer.groupBy({ by: ["status"], _count: true }),
          db.driver.findMany({ where: { status: { not: "INACTIVE" } }, take: SCAN, select: { status: true, hold: true, licenseExpiry: true, medicalExpiry: true, truck: { select: { id: true } } } }),
          db.workOrder.groupBy({ by: ["status", "stage"], where: { status: { in: ACTIVE_WO }, voidedAt: null }, _count: true }),
          db.workOrder.count({ where: { status: { in: NOT_STARTED_WO }, voidedAt: null, scheduledAt: { lt: today } } }),
          db.workOrder.findMany({ where: { status: "IN_PROGRESS", voidedAt: null }, take: SCAN, select: { truckId: true, trailerId: true, promisedAt: true } }),
          loadPaperwork(kit, now),
          db.defect.findMany({ where: { status: { not: "CLOSED" } }, take: 5000, select: { status: true, holdsUnit: true, truckId: true, dueAt: true } }),
          db.walkAround.findMany({ where: { weekStart: dateOnly(week.key) }, select: { truckId: true, video: true, reviewedAt: true } }),
          db.workOrder.findMany({ where: { ...LIVE_WO, payer: "DRIVER", driverInformedAt: null }, take: SCAN, select: { cost: true, invoiceTotal: true } }),
          db.roadsideInspection.findMany({ where: { status: "OPEN" }, select: { correctionDueAt: true } }),
        ]);
        const count = <T,>(xs: T[], fn: (x: T) => boolean) => xs.filter(fn).length;
        const oil = trucks.map((t) => serviceStatus(t, new Date(now)).state);
        const lease = trucks.map((t) => leaseNumbers(t)?.state);
        const papers = paperwork.holders.flatMap((h) => h.papers);
        const wo = (s: string) => sumOf(woByState.filter((r) => r.status === s), (r) => r._count);
        const stages = Object.fromEntries(woByState.filter((r) => r.status === "IN_PROGRESS").map((r) => [r.stage ? kit.label(REPAIR_STAGE_LABELS, r.stage) : "No stage set", r._count]));
        const withDriver = new Set(trucks.filter((t) => t.driverId).map((t) => t.id));
        const sent = walks.filter((w) => w.video === "RECEIVED");
        const expiringPeople = (d: (typeof drivers)[number]) => d.licenseExpiry <= soon || (d.medicalExpiry != null && d.medicalExpiry <= soon);
        const openDefects = defects.filter((d) => d.status === "OPEN");
        return {
          asOf: kit.dateTime(new Date(now)),
          trucks: {
            total: sumOf(byStatus, (r) => r._count),
            byStatus: Object.fromEntries(TRUCK_STATUSES.map((s) => [truckStatusLabel(s), byStatus.find((r) => r.status === s)?._count ?? 0])),
            activeWithoutDriver: count(trucks, (t) => t.status === "ACTIVE" && t.driverId == null),
            heldByDefects: new Set(defects.filter((d) => d.holdsUnit && d.truckId).map((d) => d.truckId)).size,
            href: link("/fleet"),
          },
          oil: {
            overdue: count(oil, (s) => s === "overdue"), dueNow: count(oil, (s) => s === "due_now"), dueSoon: count(oil, (s) => s === "due_soon"),
            noRecentReading: count(oil, (s) => s === "no_reading"), noOilChangeRecorded: count(oil, (s) => s === "unknown"),
            href: link("/maintenance/oil"),
          },
          lease: { overCap: count(lease, (s) => s === "over cap"), nearOrInBuffer: count(lease, (s) => s === "near cap" || s === "in buffer") },
          trailers: {
            total: sumOf(trailersByStatus, (r) => r._count),
            byStatus: Object.fromEntries(trailersByStatus.map((r) => [kit.label(TRAILER_STATUS_LABELS, r.status), r._count])),
            href: link("/fleet/trailers"),
          },
          ...(seesDrivers
            ? {
              drivers: {
                working: drivers.length, onHold: count(drivers, (d) => d.hold), onLeave: count(drivers, (d) => d.status === "ON_LEAVE"),
                activeWithoutTruck: count(drivers, (d) => d.status === "ACTIVE" && !d.hold && !d.truck),
                licenceOrMedicalExpired: count(drivers, (d) => d.licenseExpiry.getTime() < now || (d.medicalExpiry != null && d.medicalExpiry.getTime() < now)),
                licenceOrMedicalExpiringOrExpired: count(drivers, expiringPeople),
                href: link("/drivers"),
              },
            }
            : {}),
          repairOrders: {
            draft: wo("DRAFT"), scheduled: wo("OPEN"), inTheShop: wo("IN_PROGRESS"), inTheShopByStage: stages, scheduledOverdue: woOverdue,
            unitsInShop: new Set(inShop.map((w) => w.truckId ?? w.trailerId).filter(Boolean)).size,
            pastPromisedDate: count(inShop, (w) => w.promisedAt != null && w.promisedAt.getTime() < now),
            driverChargesNotTold: untold.length, ...cash({ driverChargesNotToldAmount: f.money(sumOf(untold, roAmount)) }),
            href: link("/maintenance/work-orders"),
          },
          defects: {
            open: openDefects.length, repairedWaitingToConfirm: count(defects, (d) => d.status === "REPAIRED"),
            pastDue: count(openDefects, (d) => d.dueAt != null && d.dueAt.getTime() < now),
            href: link("/inspections/defects"),
          },
          walkAroundsThisWeek: {
            week: `${f.date(week.at)} – ${f.date(weekEnd(week.at))}`, trucksWithDriver: withDriver.size,
            videosReceived: count(sent, (w) => withDriver.has(w.truckId)), waitingForReview: count(sent, (w) => !w.reviewedAt),
            href: link("/inspections"),
          },
          roadside: { openCorrections: corrections.length, correctionsPastDue: count(corrections, (c) => c.correctionDueAt != null && c.correctionDueAt.getTime() < now), href: link("/inspections/roadside") },
          paperwork: {
            expired: count(papers, (p) => p.state === "expired"), expiringWithin30Days: count(papers, (p) => p.state === "expiring"),
            requiredFilesMissing: count(papers, (p) => p.required && !p.onFile),
            href: link("/maintenance?tab=compliance"),
          },
          ...costsNote,
          ...(paperwork.scanLimited || trucks.length === SCAN ? { scanLimit: `checked the first ${SCAN} units / drivers only` } : {}),
          hints: {
            oil: `overdue = past the due odometer; due now = within ${f.dist(OIL_DUE_NOW)}; due soon = within ${f.dist(OIL_DUE_SOON)}; no recent reading = odometer older than two weeks (maintenanceDue names them)`,
            unitsDown: "unitsDown says why each truck is off the road",
            repairOrders: "workOrders names them; walkArounds, defects and roadsideInspections have the details",
          },
        };
      }),
    }),

    unitsDown: tool({
      description: "Trucks and trailers that cannot run right now, and why: status Out of service, In maintenance or Vendor, or held by a 'fix before next load' defect. Each comes with its reasons: defects holding it (DEF number, component, how long), repair orders in the shop (RO number, stage, downtime, promised date, vendor), open roadside out-of-service orders, and the driver's hold. Answers 'which trucks are out of service and why'.",
      inputSchema: z.object({ include: z.enum(["trucks", "trailers", "both"]).optional().describe("Default both") }),
      execute: ({ include }) => safely("unitsDown", async () => {
        const now = Date.now();
        const today = f.startOfDay(new Date(now));
        const which = include ?? "both";
        const holding = await db.defect.findMany({ where: { status: { not: "CLOSED" }, holdsUnit: true }, take: SCAN, select: { truckId: true, trailerId: true } });
        const heldTrucks = holding.map((d) => d.truckId).filter((x): x is string => Boolean(x));
        const heldTrailers = holding.map((d) => d.trailerId).filter((x): x is string => Boolean(x));
        const [trucks, trailers] = await Promise.all([
          which === "trailers" ? [] : db.truck.findMany({
            where: { OR: [{ status: { in: ["OUT_OF_SERVICE", "MAINTENANCE", "VENDOR"] } }, { id: { in: heldTrucks } }] }, orderBy: { unitNumber: "asc" }, take: SCAN,
            select: { id: true, unitNumber: true, make: true, model: true, status: true, notes: true, driver: { select: { id: true, name: true, hold: true, holdReason: true } } },
          }),
          which === "trucks" ? [] : db.trailer.findMany({
            where: { OR: [{ status: { in: ["OUT_OF_SERVICE", "SHOP"] } }, { id: { in: heldTrailers } }] }, orderBy: { unitNumber: "asc" }, take: SCAN,
            select: { id: true, unitNumber: true, type: true, status: true, statusSince: true },
          }),
        ]);
        const ids = [...trucks.map((t) => t.id), ...trailers.map((t) => t.id)];
        const [defects, orders, roadside] = await Promise.all([
          db.defect.findMany({ where: { status: { not: "CLOSED" }, ...unitWhere(ids) }, orderBy: { foundAt: "asc" }, select: DEFECT_ROW }),
          db.workOrder.findMany({ where: { status: "IN_PROGRESS", voidedAt: null, ...unitWhere(ids) }, orderBy: { inAt: "asc" }, select: WO_ROW }),
          db.roadsideInspection.findMany({
            where: { status: "OPEN", ...unitWhere(ids) }, orderBy: { inspectedAt: "desc" }, take: 200,
            select: { id: true, inspectedAt: true, level: true, result: true, correctionDueAt: true, truckId: true, trailerId: true, violations: { select: { oos: true } } },
          }),
        ]);
        const reasonsFor = (unitId: string) => {
          const out: string[] = [];
          for (const d of defects.filter((x) => (x.truckId ?? x.trailerId) === unitId)) {
            if (d.holdsUnit) out.push(`${defectLabel(d.number)} ${componentLabel(d.component)}: ${d.description} (${kit.label(DEFECT_SEVERITY_LABELS, d.severity)}, open ${daysSince(d.foundAt, now)}d${d.status === "REPAIRED" ? ", repaired, waiting for someone to confirm" : ""})`);
          }
          for (const w of orders.filter((x) => (x.truck?.id ?? x.trailer?.id) === unitId)) {
            const v = woView(w, kit, now, today);
            out.push(`${v.repairOrder} ${w.title}: in the shop ${kit.span(now - (w.inAt ?? w.scheduledAt).getTime())}${"stage" in v ? `, ${v.stage}` : ""}${w.promisedAt ? `, promised ${f.date(w.promisedAt)}${w.promisedAt.getTime() < now ? " (late)" : ""}` : ""}${v.vendor ? ` at ${v.vendor.name}` : ""}`);
          }
          for (const r of roadside.filter((x) => (x.truckId === unitId || x.trailerId === unitId) && (x.result === "OOS" || x.violations.some((v) => v.oos)))) {
            out.push(`Roadside out-of-service order ${f.date(r.inspectedAt)} (${INSPECTION_LEVEL_LABELS[r.level] ?? `Level ${r.level}`})${r.correctionDueAt ? `, correction due ${f.date(r.correctionDueAt)}` : ""}`);
          }
          return out;
        };
        const truckRows = trucks.map((t) => {
          const reasons = reasonsFor(t.id);
          if (t.driver?.hold) reasons.push(`${seesDrivers ? `Driver ${t.driver.name}` : "The driver"} is on hold: ${t.driver.holdReason ?? "no reason recorded"}`);
          const notes = (t.notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2);
          return {
            unit: t.unitNumber, href: link(`/fleet/${t.id}`), vehicle: `${t.make} ${t.model}`, status: truckStatusLabel(t.status),
            reasons: reasons.length ? reasons : ["no reason recorded in FleetCore: no defect holding it, no repair order in the shop and no roadside order"],
            ...(notes.length ? { notes } : {}),
          };
        });
        const trailerRows = trailers.map((t) => {
          const reasons = reasonsFor(t.id);
          return {
            unit: t.unitNumber, href: link(`/fleet/trailers/${t.id}`), type: kit.label(EQUIPMENT_LABELS, t.type), status: kit.label(TRAILER_STATUS_LABELS, t.status), since: kit.date(t.statusSince),
            reasons: reasons.length ? reasons : ["no reason recorded in FleetCore: no defect holding it and no repair order in the shop"],
          };
        });
        return {
          asOf: kit.dateTime(new Date(now)),
          trucksDown: truckRows.length, trailersDown: trailerRows.length,
          ...capped(truckRows, "trucks"),
          trailers: trailerRows.slice(0, LIMIT), trailersTruncated: trailerRows.length > LIMIT,
          href: link("/fleet"),
        };
      }),
    }),

    listTrucks: tool({
      description: "List trucks with filters: status, ownership, fleet group, truck type, make, hasDriver, oil (overdue / due_now / due_soon / due = any of those / no_reading / unknown), paperwork (expired / expiring within 30 days / missing required file), lease (over_cap / near_or_over_cap). Inactive trucks are left out unless status=INACTIVE or includeInactive. Returns the total that match and up to 25 trucks with driver and dispatcher, trailers, odometer and when it was read, oil status, paperwork dates, lease cap, last known location, open repair orders and open defects.",
      inputSchema: z.object({
        status: z.enum(TRUCK_STATUSES).optional().describe("ACTIVE (in service: Available without a driver, Assigned with one) | MAINTENANCE (in maintenance) | VENDOR (at an outside vendor) | OUT_OF_SERVICE | INACTIVE"),
        ownership: z.enum(OWNERSHIP).optional().describe("COMPANY | OWNER_OPERATOR | LEASED"),
        group: filterText("Fleet group / terminal (case-insensitive contains)"),
        truckType: filterText("Truck type name (case-insensitive contains)"),
        make: filterText("Make such as Freightliner, Volvo or Kenworth (case-insensitive contains)"),
        hasDriver: z.boolean().optional().describe("true = only trucks with a driver assigned; false = only trucks with no driver"),
        oil: OIL_FILTER.optional().describe("Filter by oil change / PM status"),
        paperwork: PAPERWORK_FILTER.optional().describe("expired | expiring (within 30 days) | expired_or_expiring | missing (registration, insurance or annual inspection file not uploaded)"),
        lease: z.enum(["over_cap", "near_or_over_cap"]).optional().describe("Leased trucks over, or near, their mileage hard cap"),
        includeInactive: z.boolean().optional(),
      }),
      execute: (q) => safely("listTrucks", async () => {
        const now = Date.now();
        const where: Prisma.TruckWhereInput = {
          AND: [
            q.status ? { status: q.status } : q.includeInactive ? {} : { status: { not: "INACTIVE" } },
            q.ownership ? { ownership: q.ownership } : {},
            q.lease ? { ownership: "LEASED", leaseAnnualLimitKm: { not: null } } : {},
            q.group ? { OR: [{ group: like(q.group) }, { homeTerminal: like(q.group) }] } : {},
            q.truckType ? { truckType: { name: like(q.truckType) } } : {},
            q.make ? { make: like(q.make) } : {},
            q.hasDriver === true ? { driverId: { not: null } } : q.hasDriver === false ? { driverId: null } : {},
          ],
        };
        const orderBy = { unitNumber: "asc" } as const;
        if (q.oil || q.paperwork || q.lease) {
          // Oil, paperwork and lease caps are arithmetic over several fields, so they are checked in memory over a bounded scan.
          const scan = await db.truck.findMany({
            where, orderBy, take: SCAN,
            select: { id: true, ...SERVICE_FIELDS, ...LEASE_FIELDS, insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true },
          });
          const docs = q.paperwork ? await docIndex("truck", scan.map((t) => t.id)) : emptyIndex();
          const ids = scan.filter((t) => {
            if (q.oil && !oilMatches(serviceStatus(t, new Date(now)).state, q.oil)) return false;
            if (q.paperwork && !papersMatch(truckPapers(t, docs.get(t.id), now), q.paperwork)) return false;
            const lease = leaseNumbers(t)?.state;
            if (q.lease === "over_cap" && lease !== "over cap") return false;
            if (q.lease === "near_or_over_cap" && (!lease || lease === "ok")) return false;
            return true;
          }).map((t) => t.id);
          const rows = await db.truck.findMany({ where: { id: { in: ids.slice(0, LIMIT) } }, orderBy, select: TRUCK_ROW });
          const rowDocs = await docIndex("truck", rows.map((t) => t.id));
          return {
            filters: q, total: ids.length, showing: rows.length, truncated: ids.length > rows.length,
            ...(scan.length === SCAN ? { scanLimit: `checked the first ${SCAN} trucks only` } : {}),
            trucks: rows.map((t) => truckView(t, rowDocs, kit, now)),
            href: link("/fleet"),
          };
        }
        const [total, rows] = await Promise.all([db.truck.count({ where }), db.truck.findMany({ where, orderBy, take: LIMIT, select: TRUCK_ROW })]);
        const docs = await docIndex("truck", rows.map((t) => t.id));
        return { filters: q, total, showing: rows.length, truncated: total > rows.length, trucks: rows.map((t) => truckView(t, docs, kit, now)), href: link("/fleet") };
      }),
    }),

    truckDetail: tool({
      description: "Open one truck by unit number, plate or VIN: status, truck type, driver and dispatcher, trailers, odometer and when it was read, oil change status and the oil service if booked, paperwork with expiry dates and files on record, lease cap, last known location, open repair orders (stage, who pays, vendor), open defects, this week's walk-around, roadside inspections in the last 12 months, the last 5 completed repairs, and the last 90 days: distance, fuel, fuel economy and (for roles that see money) maintenance and fuel spend and cost per distance. If several trucks match, returns the candidates instead.",
      inputSchema: z.object({ unit: queryText("Truck unit number, plate or VIN") }),
      execute: ({ unit: q }) => safely("truckDetail", async () => {
        let hits = await db.truck.findMany({ where: { OR: [{ unitNumber: exact(q) }, { plate: exact(q) }, { vin: exact(q) }] }, select: { id: true }, take: 2 });
        if (hits.length !== 1) hits = await db.truck.findMany({ where: { OR: [{ unitNumber: like(q) }, { plate: like(q) }, { vin: like(q) }] }, select: { id: true }, take: 6, orderBy: { unitNumber: "asc" } });
        if (hits.length === 0) return { found: false, message: `No truck matches "${q}". Check the unit number, or use search.` };
        if (hits.length > 1) {
          const rows = await db.truck.findMany({ where: { id: { in: hits.map((h) => h.id) } }, orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, make: true, model: true, plate: true, status: true } });
          return { found: false, candidates: rows.map((t) => ({ unit: t.unitNumber, vehicle: `${t.make} ${t.model}`, plate: t.plate, status: truckStatusLabel(t.status), href: link(`/fleet/${t.id}`) })) };
        }
        const id = hits[0].id;
        const now = Date.now();
        const today = f.startOfDay(new Date(now));
        const from = new Date(now - 90 * DAY);
        const week = f.weekStart(new Date(now));
        const [t, open, done, spend, fuel, km, docs, defects, walk, roadside] = await Promise.all([
          db.truck.findUniqueOrThrow({ where: { id }, select: { ...TRUCK_ROW, fuelType: true, fuelCapacityL: true, fuelEconomy: true, engineHours: true, notes: true } }),
          db.workOrder.findMany({ where: { truckId: id, status: { in: ACTIVE_WO }, voidedAt: null }, orderBy: { scheduledAt: "asc" }, take: 10, select: WO_ROW }),
          db.workOrder.findMany({ where: { truckId: id, status: "DONE", voidedAt: null }, orderBy: { completedAt: "desc" }, take: 5, select: WO_ROW }),
          db.workOrder.findMany({ where: { truckId: id, status: "DONE", voidedAt: null, completedAt: { gte: from } }, select: { cost: true, invoiceTotal: true } }),
          db.fuelLog.aggregate({ where: { truckId: id, date: { gte: from } }, _sum: { cost: true, liters: true }, _count: true }),
          kmDriven(from, new Date(now), [id]),
          docIndex("truck", [id]),
          db.defect.findMany({ where: { truckId: id, status: { not: "CLOSED" } }, take: 20, select: DEFECT_ROW }),
          db.walkAround.findFirst({ where: { truckId: id, weekStart: dateOnly(week.key) }, select: { video: true, receivedAt: true, reviewedAt: true, result: true } }),
          db.roadsideInspection.findMany({ where: { truckId: id, inspectedAt: { gte: new Date(now - 365 * DAY) } }, orderBy: { inspectedAt: "desc" }, take: 10, select: { id: true, inspectedAt: true, level: true, result: true, status: true, violations: { select: { oos: true } } } }),
        ]);
        const driven = km.byTruck.get(id) ?? 0;
        const maintenance = sumOf(spend, roAmount);
        const fuelCost = fuel._sum.cost ?? 0;
        const volume = fuel._sum.liters ?? 0;
        const oilJob = open.find((w) => w.repairType === "OIL_CHANGE" || w.repairType === "PM_INSPECTION");
        const notes = (t.notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5).map((l) => (l.length > 200 ? `${l.slice(0, 197)}…` : l));
        const economy = f.economy(driven, volume);
        return {
          found: true,
          ...truckView(t, docs, kit, now),
          fuel: { type: humanize(t.fuelType), tank: f.vol(t.fuelCapacityL), rollingEconomy: t.fuelEconomy == null ? null : f.economyText(t.fuelEconomy) },
          engineHours: t.engineHours,
          oilService: oilJob ? { repairOrder: roLabel(oilJob.number), status: RO_STATUS[oilJob.status] ?? humanize(oilJob.status), scheduled: kit.date(oilJob.scheduledAt), href: link(`/maintenance/work-orders/${oilJob.id}`) } : null,
          openRepairOrders: open.map((w) => woView(w, kit, now, today)),
          openDefects: defects.sort(defectOrder).map((d) => defectView(d, kit, now)),
          walkAroundThisWeek: walk
            ? { video: walk.video === "RECEIVED" ? `received ${kit.date(walk.receivedAt) ?? ""}`.trim() : walk.video === "MISSING" ? "marked missing" : "not sent yet", reviewed: walk.reviewedAt ? `${kit.date(walk.reviewedAt)}: ${walk.result === "ISSUES" ? "issues found" : "clean"}` : "not reviewed yet" }
            : { video: "not sent yet", dueBy: kit.dateTime(weekEnd(week.at)) },
          roadsideLast12Months: roadside.map((r) => ({
            date: kit.date(r.inspectedAt), level: INSPECTION_LEVEL_LABELS[r.level] ?? `Level ${r.level}`, result: kit.label(ROADSIDE_RESULT_LABELS, r.result),
            violations: r.violations.length, outOfService: r.result === "OOS" || r.violations.some((v) => v.oos), status: kit.label(ROADSIDE_STATUS_LABELS, r.status), href: link(`/inspections/roadside/${r.id}`),
          })),
          lastCompletedRepairs: done.map((w) => woView(w, kit, now, today)),
          last90Days: {
            distance: f.dist(driven), repairsCompleted: spend.length, fuel: f.vol(volume), fuelFills: fuel._count, fuelEconomy: f.economyText(economy),
            ...cash({
              maintenance: f.money(maintenance), fuelSpend: f.money(fuelCost),
              costPerDistance: driven > 0 ? `${f.money2((maintenance + fuelCost) / driven)} ${L.perDistance}` : null,
            }),
            ...(driven === 0 ? { note: "no distance: fewer than two odometer readings in the last 90 days" } : {}),
          },
          ...costsNote,
          recentNotes: notes,
        };
      }),
    }),

    listTrailers: tool({
      description: "List trailers with filters: status, body type, paired (hooked to a truck or not), paperwork (expired / expiring / missing file), q (unit number or plate). Returns the total that match and up to 25 trailers with type, capacity, status and days in it, paired truck, insurance and inspection dates, last known location, open repair orders and defects. Inactive trailers are left out unless status INACTIVE is asked for.",
      inputSchema: z.object({
        status: z.enum(TRAILER_STATUSES).optional().describe("IN_USE | EMPTY | DROPPED | YARD | SHOP (in maintenance) | OUT_OF_SERVICE | INACTIVE (sold or parked for good)"),
        type: z.enum(EQUIPMENT).optional().describe("DRY_VAN | REEFER | FLATBED | TANKER | CONTAINER"),
        paired: z.boolean().optional().describe("true = hooked to a truck; false = not paired"),
        paperwork: PAPERWORK_FILTER.optional(),
        q: filterText("Unit number or plate (case-insensitive contains)"),
      }),
      execute: (q) => safely("listTrailers", async () => {
        const now = Date.now();
        const where: Prisma.TrailerWhereInput = {
          AND: [
            q.status ? { status: q.status } : { status: { not: "INACTIVE" } },
            q.type ? { type: q.type } : {},
            q.paired === true ? { truckId: { not: null } } : q.paired === false ? { truckId: null } : {},
            q.q ? { OR: [{ unitNumber: like(q.q) }, { plate: like(q.q) }] } : {},
          ],
        };
        const orderBy = { unitNumber: "asc" } as const;
        if (q.paperwork) {
          const scan = await db.trailer.findMany({ where, orderBy, take: SCAN, select: { id: true, insuranceExpiry: true, inspectionExpiry: true } });
          const docs = await docIndex("trailer", scan.map((t) => t.id));
          const ids = scan.filter((t) => papersMatch(trailerPapers(t, docs.get(t.id), now), q.paperwork!)).map((t) => t.id);
          const rows = await db.trailer.findMany({ where: { id: { in: ids.slice(0, LIMIT) } }, orderBy, select: TRAILER_ROW });
          return {
            filters: q, total: ids.length, showing: rows.length, truncated: ids.length > rows.length,
            ...(scan.length === SCAN ? { scanLimit: `checked the first ${SCAN} trailers only` } : {}),
            trailers: rows.map((t) => trailerView(t, docs, kit, now)), href: link("/fleet/trailers"),
          };
        }
        const [total, rows] = await Promise.all([db.trailer.count({ where }), db.trailer.findMany({ where, orderBy, take: LIMIT, select: TRAILER_ROW })]);
        const docs = await docIndex("trailer", rows.map((t) => t.id));
        return { filters: q, total, showing: rows.length, truncated: total > rows.length, trailers: rows.map((t) => trailerView(t, docs, kit, now)), href: link("/fleet/trailers") };
      }),
    }),

    maintenanceDue: tool({
      description: `Oil change / PM status by odometer, the same rule as the Oil changes board: the interval comes from the truck's type (else the truck's own), due at = last oil change odometer + interval. Overdue = past it; due now = within ${f.dist(OIL_DUE_NOW)}; due soon = within ${f.dist(OIL_DUE_SOON)}; an odometer reading older than two weeks makes the figures bounds ("at least … used") and shows as no recent reading. Most overdue first, each with the oil service repair order if one is booked. Answers 'which trucks are overdue for an oil change'.`,
      inputSchema: z.object({
        within: z.number().int().min(0).max(100_000).optional().describe(`Include trucks due within this distance in ${L.distanceLong} (default ${OIL_DUE_SOON}). Overdue trucks are always included.`),
        truckType: filterText("Only this truck type (case-insensitive contains)"),
      }),
      execute: ({ within, truckType }) => safely("maintenanceDue", async () => {
        const now = Date.now();
        const horizon = within ?? OIL_DUE_SOON;
        const [trucks, booked] = await Promise.all([
          // Service due is odometer arithmetic, so it is checked in memory over a bounded scan of light rows.
          db.truck.findMany({
            where: { status: { not: "INACTIVE" }, ...(truckType ? { truckType: { name: like(truckType) } } : {}) }, orderBy: { unitNumber: "asc" }, take: SCAN,
            select: { id: true, unitNumber: true, make: true, model: true, year: true, status: true, locationName: true, ...SERVICE_FIELDS, driver: { select: { name: true } } },
          }),
          db.workOrder.findMany({
            where: { OR: [{ repairType: "OIL_CHANGE" }, { category: "PM" }], status: { in: ACTIVE_WO }, voidedAt: null, truckId: { not: null } },
            orderBy: { scheduledAt: "asc" }, select: { id: true, number: true, status: true, scheduledAt: true, vendor: true, vendorRef: { select: { name: true } }, truckId: true },
          }),
        ]);
        const bookedBy = new Map<string, (typeof booked)[number]>();
        for (const w of booked) if (w.truckId && !bookedBy.has(w.truckId)) bookedBy.set(w.truckId, w);
        const rows = trucks.map((t) => ({ t, s: serviceStatus(t as ServiceRow, new Date(now)) }));
        const view = ({ t, s }: (typeof rows)[number]) => {
          const w = bookedBy.get(t.id);
          return {
            unit: t.unitNumber, href: link(`/fleet/${t.id}`), vehicle: `${t.year} ${t.make} ${t.model}`, truckType: t.truckType?.name ?? null, status: truckStatusLabel(t.status),
            driver: seesDrivers ? (t.driver?.name ?? null) : undefined, odometer: f.dist(t.odometerKm), location: t.locationName,
            ...oilView(t, s, kit),
            booked: w ? { repairOrder: roLabel(w.number), status: RO_STATUS[w.status] ?? humanize(w.status), scheduled: kit.date(w.scheduledAt), vendor: w.vendorRef?.name ?? w.vendor, href: link(`/maintenance/work-orders/${w.id}`) } : null,
          };
        };
        const due = rows
          .filter(({ s }) => s.left != null && (s.state === "overdue" || (s.state !== "no_reading" && s.left <= horizon)))
          .sort((a, b) => (a.s.left ?? 0) - (b.s.left ?? 0))
          .map(view);
        const noReading = rows.filter(({ s }) => s.state === "no_reading").sort((a, b) => (a.s.left ?? 0) - (b.s.left ?? 0)).map(view);
        const count = (st: ServiceState) => rows.filter((r) => r.s.state === st).length;
        return {
          within: f.dist(horizon), overdue: count("overdue"), dueNow: count("due_now"), dueSoon: count("due_soon"),
          notBooked: due.filter((t) => !t.booked).length, noRecentReading: noReading.length, noOilChangeRecorded: count("unknown"),
          ...capped(due, "trucks"),
          needAReading: noReading.slice(0, 10),
          ...(trucks.length === SCAN ? { scanLimit: `checked the first ${SCAN} trucks only` } : {}),
          href: link("/maintenance/oil"),
        };
      }),
    }),

    workOrders: tool({
      description: "Repair orders (RO-0137) with filters. status: active (draft, scheduled or in the shop; default), overdue (scheduled before today, not started), in_shop (in the shop now), past_promised (in the shop past the promised date), DRAFT, OPEN (scheduled), IN_PROGRESS, DONE (completed), CANCELLED, voided, all. Also stage (where a job in the shop has got to), payer (who pays: COMPANY / DRIVER / INVESTIGATION / WARRANTY), driverNotTold (driver charges the driver has not been told about), repairType, unit, vendor, priority and a date range (completion date for DONE, scheduled date otherwise). Returns the total and up to 25 orders with unit, type, status and stage, downtime, promised date, vendor, technician, who pays and whether the driver was told, what was done, and (for roles that see money) cost and invoice.",
      inputSchema: z.object({
        status: z.enum(WO_FILTERS).optional(),
        stage: z.enum(REPAIR_STAGES).optional().describe("DIAGNOSING | WAITING_APPROVAL | WAITING_PARTS | IN_REPAIR | QUALITY_CHECK | READY_PICKUP"),
        payer: z.enum(PAYERS).optional().describe("COMPANY | DRIVER | INVESTIGATION | WARRANTY"),
        driverNotTold: z.boolean().optional().describe("true = only driver charges the driver has not been told about"),
        repairType: z.enum(REPAIR_TYPES).optional(),
        unit: filterText("Truck or trailer unit number"),
        vendor: filterText("Vendor name (case-insensitive contains)"),
        priority: z.enum(WORK_ORDER_PRIORITIES).optional().describe("LOW | MEDIUM | HIGH | URGENT"),
        from: dateText("First day, YYYY-MM-DD"),
        to: dateText("Last day (inclusive), YYYY-MM-DD"),
      }),
      execute: (q) => safely("workOrders", async () => {
        const now = Date.now();
        const today = f.startOfDay(new Date(now));
        const s = q.driverNotTold && !q.status ? "all" : (q.status ?? "active");
        let unitIds: string[] = [];
        if (q.unit) {
          const units = await findUnits(q.unit);
          if (!units.trucks.length && !units.trailers.length) return { found: false, message: `No truck or trailer matches "${q.unit}".` };
          unitIds = [...units.trucks, ...units.trailers].map((u) => u.id);
        }
        let range: Prisma.WorkOrderWhereInput = {};
        if (q.from || q.to) {
          const b = kit.dayBounds(q.from, q.to);
          if ("error" in b) return b;
          range = s === "DONE" ? { completedAt: b } : { scheduledAt: b };
        }
        const byStatus: Prisma.WorkOrderWhereInput =
          s === "active" ? { status: { in: ACTIVE_WO }, voidedAt: null }
            : s === "overdue" ? { status: { in: NOT_STARTED_WO }, voidedAt: null, scheduledAt: { lt: today } }
              : s === "in_shop" ? { status: "IN_PROGRESS", voidedAt: null }
                : s === "past_promised" ? { status: "IN_PROGRESS", voidedAt: null, promisedAt: { lt: new Date(now) } }
                  : s === "voided" ? { voidedAt: { not: null } }
                    : s === "all" ? { voidedAt: null } : { status: s, voidedAt: null };
        const where: Prisma.WorkOrderWhereInput = {
          AND: [
            byStatus,
            unitIds.length ? unitWhere(unitIds) : {},
            q.stage ? { stage: q.stage, status: "IN_PROGRESS" } : {},
            q.payer ? { payer: q.payer } : {},
            q.driverNotTold ? { payer: "DRIVER", driverInformedAt: null, status: { not: "CANCELLED" } } : {},
            q.repairType ? { repairType: q.repairType } : {},
            q.priority ? { priority: q.priority } : {},
            q.vendor ? { OR: [{ vendor: like(q.vendor) }, { vendorRef: { name: like(q.vendor) } }] } : {},
            range,
          ],
        };
        const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] =
          s === "DONE" ? [{ completedAt: "desc" }, { number: "desc" }]
            : s === "CANCELLED" || s === "all" || s === "voided" ? [{ scheduledAt: "desc" }, { number: "desc" }]
              : [{ scheduledAt: "asc" }, { number: "asc" }];
        const [total, rows, money] = await Promise.all([
          db.workOrder.count({ where }),
          db.workOrder.findMany({ where, orderBy, take: LIMIT, select: WO_ROW }),
          seesMoney ? db.workOrder.findMany({ where, take: 20_000, select: { cost: true, invoiceTotal: true } }) : Promise.resolve([]),
        ]);
        return {
          filters: q, total, showing: rows.length, truncated: total > rows.length,
          ...cash({ totalCost: f.money(sumOf(money, roAmount)) }),
          ...costsNote,
          repairOrders: rows.map((w) => woView(w, kit, now, today)),
          href: link(unitIds.length === 1 ? `/maintenance/work-orders?unit=${unitIds[0]}` : "/maintenance/work-orders"),
        };
      }),
    }),

    vendors: tool({
      description: "Vendors (shops, dealers, tire, road-side, towing, parts) with how much the fleet uses them: completed repair orders in a period (default the last 365 days), all-time orders, last used and (for roles that see money) spend and average per order; plus the most used and the biggest spend, and shop names typed on orders that are not linked to a vendor record. Filters: q (name, phone or city), type. sort: visits (default), spend, recent.",
      inputSchema: z.object({
        q: filterText("Vendor name, phone or city (case-insensitive contains)"),
        type: z.enum(VENDOR_TYPES).optional().describe("DEALER | SHOP | TIRE | MOBILE | TOWING | PARTS | OTHER"),
        sort: z.enum(["visits", "spend", "recent"]).optional(),
        from: dateText("First day, YYYY-MM-DD. Default: 365 days before `to`."),
        to: dateText("Last day (inclusive), YYYY-MM-DD. Default: today."),
        includeInactive: z.boolean().optional(),
      }),
      execute: (q) => safely("vendors", async () => {
        const now = Date.now();
        const p = kit.resolvePeriod(q.from, q.to, now, 365);
        if ("error" in p) return p;
        const vendors = await db.vendor.findMany({
          where: {
            AND: [
              q.includeInactive ? {} : { active: true },
              q.type ? { type: q.type } : {},
              q.q ? { OR: [{ name: like(q.q) }, { phone: like(q.q) }, { city: like(q.q) }, { contactName: like(q.q) }] } : {},
            ],
          },
          orderBy: { name: "asc" }, take: SCAN,
          select: { id: true, name: true, type: true, phone: true, email: true, city: true, contactName: true, active: true },
        });
        const ids = vendors.map((v) => v.id);
        const done: Prisma.WorkOrderWhereInput = { status: "DONE", voidedAt: null, completedAt: { gte: p.from, lt: p.to } };
        const [inPeriod, allTime, lastUsed, unlinked] = await Promise.all([
          db.workOrder.findMany({ where: { ...done, vendorId: { in: ids } }, take: 50_000, select: { vendorId: true, cost: true, invoiceTotal: true } }),
          db.workOrder.groupBy({ by: ["vendorId"], where: { ...LIVE_WO, vendorId: { in: ids } }, _count: true }),
          db.workOrder.groupBy({ by: ["vendorId"], where: { ...LIVE_WO, vendorId: { in: ids } }, _max: { scheduledAt: true, completedAt: true } }),
          q.q || q.type ? Promise.resolve([]) : db.workOrder.groupBy({ by: ["vendor"], where: { ...done, vendorId: null, vendor: { not: null } }, _count: true, orderBy: { _count: { vendor: "desc" } }, take: 5 }),
        ]);
        const stats = new Map<string, { orders: number; spend: number }>();
        for (const w of inPeriod) {
          const e = stats.get(w.vendorId!) ?? { orders: 0, spend: 0 };
          e.orders++; e.spend += roAmount(w);
          stats.set(w.vendorId!, e);
        }
        const all = new Map(allTime.map((g) => [g.vendorId, g._count]));
        const last = new Map(lastUsed.map((g) => {
          const a = g._max.completedAt; const b = g._max.scheduledAt;
          return [g.vendorId, a && b ? (a > b ? a : b) : (a ?? b)];
        }));
        const sort = q.sort === "spend" && !seesMoney ? "visits" : (q.sort ?? "visits");
        const rows = vendors
          .map((v) => ({ v, s: stats.get(v.id) ?? { orders: 0, spend: 0 }, last: last.get(v.id) ?? null }))
          .sort((a, b) =>
            sort === "spend" ? b.s.spend - a.s.spend || b.s.orders - a.s.orders
              : sort === "recent" ? (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0)
                : b.s.orders - a.s.orders || b.s.spend - a.s.spend);
        const view = ({ v, s, last: l }: (typeof rows)[number]) => ({
          name: v.name, href: link(`/vendors/${v.id}`), type: kit.label(VENDOR_TYPE_LABELS, v.type), phone: v.phone, email: v.email, city: v.city, contact: v.contactName,
          ...(v.active ? {} : { inactive: true }),
          completedInPeriod: s.orders, allTimeOrders: all.get(v.id) ?? 0, lastUsed: kit.date(l),
          ...cash({ spendInPeriod: f.money(s.spend), averagePerOrder: s.orders ? f.money(s.spend / s.orders) : null }),
        });
        const used = rows.filter((r) => r.s.orders > 0);
        const mostUsed = [...used].sort((a, b) => b.s.orders - a.s.orders)[0];
        const mostSpent = [...used].sort((a, b) => b.s.spend - a.s.spend)[0];
        return {
          period: p.label, sort,
          mostUsed: mostUsed ? { name: mostUsed.v.name, completedOrders: mostUsed.s.orders, href: link(`/vendors/${mostUsed.v.id}`) } : null,
          ...cash({ biggestSpend: mostSpent ? { name: mostSpent.v.name, spend: f.money(mostSpent.s.spend), href: link(`/vendors/${mostSpent.v.id}`) } : null }),
          ...capped(rows.map(view), "vendors"),
          ...(unlinked.length ? { typedOnOrdersWithoutVendorRecord: unlinked.map((g) => ({ name: g.vendor, completedOrders: g._count })) } : {}),
          ...costsNote,
          href: link("/vendors"),
        };
      }),
    }),

    walkArounds: tool({
      description: "Weekly walk-around (pre-trip video) status for one week: which trucks with a driver have not sent their video (with the driver, phone and dispatcher to chase), which videos are waiting for review, which reviews found issues, and how many drivers sent theirs. Weeks start on Sunday for imperial companies and Monday for metric ones; videos are due by the end of the week. Default: this week. Answers 'who hasn't sent a walk-around this week'.",
      inputSchema: z.object({
        week: z.string().trim().regex(/^(this|last|\d{4}-\d{2}-\d{2})$/, "Use this, last or YYYY-MM-DD").optional().describe("this (default), last, or any day of the week as YYYY-MM-DD"),
        show: z.enum(["needs_attention", "not_sent", "to_review", "issues", "all"]).optional().describe("Which trucks to list (default needs_attention: not sent, to review and issues)"),
      }),
      execute: (q) => safely("walkArounds", async () => {
        const now = Date.now();
        const thisWeek = f.weekStart(new Date(now));
        let base = new Date(now);
        if (q.week === "last") base = new Date(thisWeek.at.getTime() - 3 * DAY);
        else if (q.week && q.week !== "this") {
          const d = kit.parseDay(q.week);
          if (!d) return { error: `${q.week} is not a valid date. Use YYYY-MM-DD.` };
          base = new Date(d.getTime() + 12 * 3_600_000);
        }
        const wk = f.weekStart(base);
        const dueAt = weekEnd(wk.at);
        if (wk.at.getTime() > now) return { error: "That week has not started yet." };
        const [trucks, rows, defects] = await Promise.all([
          db.truck.findMany({
            where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" }, take: SCAN,
            select: { id: true, unitNumber: true, status: true, driver: { select: { id: true, name: true, phone: true, dispatcher: true } } },
          }),
          db.walkAround.findMany({
            where: { weekStart: dateOnly(wk.key) },
            select: { truckId: true, video: true, receivedAt: true, reviewedAt: true, result: true, reviewedBy: { select: { name: true } }, _count: { select: { defects: true } } },
          }),
          db.defect.findMany({ where: { status: { not: "CLOSED" }, truckId: { not: null } }, take: 5000, select: { truckId: true, holdsUnit: true } }),
        ]);
        const byTruck = new Map(rows.map((r) => [r.truckId, r]));
        const expected = trucks.filter((t) => t.driver || byTruck.has(t.id));
        const items = expected.map((t) => {
          const r = byTruck.get(t.id);
          const state = r?.video === "RECEIVED" ? (r.reviewedAt ? (r.result === "ISSUES" ? "issues" : "clean") : "to_review") : r?.video === "MISSING" ? "missing" : "not_sent";
          const open = defects.filter((d) => d.truckId === t.id);
          return {
            state,
            view: {
              unit: t.unitNumber, href: link(`/fleet/${t.id}`), truckStatus: truckStatusLabel(t.status),
              ...(seesDrivers ? { driver: t.driver ? { name: t.driver.name, phone: t.driver.phone, dispatcher: t.driver.dispatcher, href: link(`/drivers/${t.driver.id}`) } : null } : {}),
              video: state === "not_sent" ? "nothing sent yet" : state === "missing" ? "marked missing" : `received ${kit.date(r?.receivedAt) ?? ""}`.trim(),
              ...(r?.reviewedAt ? { reviewed: `${kit.date(r.reviewedAt)}${r.reviewedBy ? ` by ${r.reviewedBy.name}` : ""}`, result: r.result === "ISSUES" ? `issues found (${r._count.defects} defects)` : "clean" } : {}),
              openDefects: open.length, holdingTruck: open.some((d) => d.holdsUnit),
            },
          };
        });
        const pick = (st: string) => items.filter((i) => i.state === st).map((i) => i.view);
        const notSent = [...pick("not_sent"), ...pick("missing")];
        const show = q.show ?? "needs_attention";
        const sent = items.filter((i) => ["to_review", "clean", "issues"].includes(i.state)).length;
        return {
          week: `${f.date(wk.at)} – ${f.date(dueAt)}`, dueBy: kit.dateTime(dueAt), weekIsOver: dueAt.getTime() < now,
          trucksExpected: expected.length, videosSent: sent, notSent: notSent.length, waitingForReview: pick("to_review").length,
          reviewedWithIssues: pick("issues").length, reviewedClean: pick("clean").length, driversWhoSent: `${sent} of ${expected.length}`,
          ...(show === "needs_attention" || show === "not_sent" ? { notSentList: notSent.slice(0, LIMIT), notSentTruncated: notSent.length > LIMIT } : {}),
          ...(show === "needs_attention" || show === "to_review" ? { toReviewList: pick("to_review").slice(0, LIMIT) } : {}),
          ...(show === "needs_attention" || show === "issues" ? { issuesList: pick("issues").slice(0, LIMIT) } : {}),
          ...(show === "all" ? { trucks: items.map((i) => i.view).slice(0, LIMIT), truncated: items.length > LIMIT } : {}),
          href: link("/inspections"),
        };
      }),
    }),

    defects: tool({
      description: "Defects (DEF-0021) found on walk-arounds or reported. Default: open ones (open, and repaired but waiting for someone to confirm), those holding a truck out of service first, then by severity (fix before next load, within 2 weeks, watch). Each with unit, component, description, how long open, due date, owner and the repair order fixing it. Filters: status, holdingTruck, severity, overdue, unit.",
      inputSchema: z.object({
        status: z.enum(["open", "OPEN", "REPAIRED", "CLOSED", "all"]).optional().describe("open (default: OPEN or REPAIRED waiting to be confirmed) | OPEN | REPAIRED | CLOSED | all"),
        holdingTruck: z.boolean().optional().describe("true = only defects keeping a truck out of service"),
        severity: z.enum(DEFECT_SEVERITIES).optional().describe("NOW (fix before next load) | SOON (within 2 weeks) | WATCH"),
        overdue: z.boolean().optional().describe("true = only open defects past their due date"),
        unit: filterText("Truck or trailer unit number"),
      }),
      execute: (q) => safely("defects", async () => {
        const now = Date.now();
        const s = q.status ?? "open";
        let unitIds: string[] = [];
        if (q.unit) {
          const units = await findUnits(q.unit);
          if (!units.trucks.length && !units.trailers.length) return { found: false, message: `No truck or trailer matches "${q.unit}".` };
          unitIds = [...units.trucks, ...units.trailers].map((u) => u.id);
        }
        const where: Prisma.DefectWhereInput = {
          AND: [
            s === "open" ? { status: { not: "CLOSED" } } : s === "all" ? {} : { status: s },
            q.holdingTruck ? { holdsUnit: true, status: { not: "CLOSED" } } : {},
            q.severity ? { severity: q.severity } : {},
            q.overdue ? { status: "OPEN", dueAt: { lt: new Date(now) } } : {},
            unitIds.length ? unitWhere(unitIds) : {},
          ],
        };
        const rows = await db.defect.findMany({ where, take: SCAN, orderBy: s === "CLOSED" ? { closedAt: "desc" } : { foundAt: "asc" }, select: DEFECT_ROW });
        const sorted = s === "CLOSED" ? rows : [...rows].sort(defectOrder);
        const open = rows.filter((d) => d.status !== "CLOSED");
        return {
          filters: q,
          holdingTrucks: new Set(open.filter((d) => d.holdsUnit && d.truckId).map((d) => d.truckId)).size,
          repairedWaitingToConfirm: open.filter((d) => d.status === "REPAIRED").length,
          ...capped(sorted.map((d) => defectView(d, kit, now)), "defects"),
          ...(rows.length === SCAN ? { scanLimit: `read the first ${SCAN} defects only` } : {}),
          href: link("/inspections/defects"),
        };
      }),
    }),

    roadsideInspections: tool({
      description: "Roadside (DOT) inspections in a period (default the last 365 days): how many, clean, with violations, total violations, out-of-service rate, by level, open corrections and those past due; then up to 25 inspections, most recent first, with report number, level, place, driver, truck and trailer, result, violations (code, description, driver / truck / trailer, out of service, corrected) and the correction due date. Filters: result, status, outOfService, unit, driver.",
      inputSchema: z.object({
        from: dateText("First day, YYYY-MM-DD. Default: 365 days before `to`."),
        to: dateText("Last day (inclusive), YYYY-MM-DD. Default: today."),
        result: z.enum(ROADSIDE_RESULTS).optional().describe("CLEAN | VIOLATIONS | OOS"),
        status: z.enum(ROADSIDE_STATUSES).optional().describe("OPEN (correction pending) | CORRECTED | CLOSED"),
        outOfService: z.boolean().optional().describe("true = only inspections with an out-of-service order"),
        unit: filterText("Truck or trailer unit number"),
        driver: filterText("Driver name (case-insensitive contains)"),
      }),
      execute: (q) => safely("roadsideInspections", async () => {
        const now = Date.now();
        const p = kit.resolvePeriod(q.from, q.to, now, 365);
        if ("error" in p) return p;
        let unitIds: string[] = [];
        if (q.unit) {
          const units = await findUnits(q.unit);
          if (!units.trucks.length && !units.trailers.length) return { found: false, message: `No truck or trailer matches "${q.unit}".` };
          unitIds = [...units.trucks, ...units.trailers].map((u) => u.id);
        }
        const where: Prisma.RoadsideInspectionWhereInput = {
          AND: [
            { inspectedAt: { gte: p.from, lt: p.to } },
            q.result ? { result: q.result } : {},
            q.status ? { status: q.status } : {},
            q.outOfService ? { OR: [{ result: "OOS" }, { violations: { some: { oos: true } } }] } : {},
            unitIds.length ? unitWhere(unitIds) : {},
            q.driver && seesDrivers ? { driver: { name: like(q.driver) } } : {},
          ],
        };
        const rows = await db.roadsideInspection.findMany({
          where, orderBy: { inspectedAt: "desc" }, take: SCAN,
          select: {
            id: true, inspectedAt: true, reportNumber: true, level: true, state: true, location: true, result: true, status: true, correctionDueAt: true, notes: true,
            driver: { select: { id: true, name: true } }, ...UNIT_SELECT,
            violations: { select: { code: true, description: true, unit: true, oos: true, correctedAt: true } },
          },
        });
        const oos = (r: (typeof rows)[number]) => r.result === "OOS" || r.violations.some((v) => v.oos);
        const levels = new Map<number, { inspections: number; violations: number; outOfService: number }>();
        for (const r of rows) {
          const l = levels.get(r.level) ?? { inspections: 0, violations: 0, outOfService: 0 };
          l.inspections++; l.violations += r.violations.length; if (oos(r)) l.outOfService++;
          levels.set(r.level, l);
        }
        const openRows = rows.filter((r) => r.status === "OPEN");
        const list = rows.map((r) => ({
          date: kit.date(r.inspectedAt), href: link(`/inspections/roadside/${r.id}`), reportNumber: r.reportNumber, level: INSPECTION_LEVEL_LABELS[r.level] ?? `Level ${r.level}`,
          place: [r.location, r.state].filter(Boolean).join(", ") || null,
          ...(seesDrivers ? { driver: r.driver ? { name: r.driver.name, href: link(`/drivers/${r.driver.id}`) } : null } : {}),
          truck: r.truck ? { unit: r.truck.unitNumber, href: link(`/fleet/${r.truck.id}`) } : null,
          trailer: r.trailer ? { unit: r.trailer.unitNumber, href: link(`/fleet/trailers/${r.trailer.id}`) } : null,
          result: oos(r) ? "Out of service" : kit.label(ROADSIDE_RESULT_LABELS, r.result), status: kit.label(ROADSIDE_STATUS_LABELS, r.status),
          ...(r.status === "OPEN" && r.correctionDueAt ? { correctionDue: kit.date(r.correctionDueAt), ...(r.correctionDueAt.getTime() < now ? { correctionPastDue: true } : {}) } : {}),
          violations: r.violations.slice(0, 6).map((v) => ({ code: v.code, description: v.description, on: humanize(v.unit), outOfService: v.oos, corrected: kit.date(v.correctedAt) })),
          ...(r.violations.length > 6 ? { moreViolations: r.violations.length - 6 } : {}),
        }));
        const oosCount = rows.filter(oos).length;
        return {
          period: p.label, filters: q,
          inspections: rows.length, clean: rows.filter((r) => r.result === "CLEAN" && r.violations.length === 0).length,
          withViolations: rows.filter((r) => r.violations.length > 0 || r.result !== "CLEAN").length,
          violations: sumOf(rows, (r) => r.violations.length),
          driverViolations: sumOf(rows, (r) => r.violations.filter((v) => v.unit === "DRIVER").length),
          vehicleViolations: sumOf(rows, (r) => r.violations.filter((v) => v.unit !== "DRIVER").length),
          outOfService: oosCount, outOfServiceRate: rows.length ? `${round((oosCount / rows.length) * 100, 1)}%` : null,
          byLevel: [...levels].sort((a, b) => a[0] - b[0]).map(([lvl, v]) => ({ level: INSPECTION_LEVEL_LABELS[lvl] ?? `Level ${lvl}`, ...v })),
          openCorrections: openRows.length, correctionsPastDue: openRows.filter((r) => r.correctionDueAt && r.correctionDueAt.getTime() < now).length,
          ...capped(list, "roadsideInspections"),
          href: link("/inspections/roadside"),
        };
      }),
    }),

    expiringPaperwork: tool({
      description: "Paperwork that expires soon or has expired, soonest first: truck registration, insurance and annual inspection, trailer insurance, inspection and registration, driver licences and medical certificates, plus any other uploaded document with an expiry date (IFTA, permits, leases, warranties, company documents). Default window: the next 30 days, expired included. For 'this month' pass until = the last day of the month.",
      inputSchema: z.object({
        withinDays: z.number().int().min(0).max(366).optional().describe("Expiring within this many days from now (default 30)"),
        until: dateText("Or: expiring on or before this day, YYYY-MM-DD. Wins over withinDays."),
        includeExpired: z.boolean().optional().describe("Include paperwork that has already expired (default true)"),
        owner: z.enum(["truck", "trailer", "driver", "company"]).optional(),
      }),
      execute: (q) => safely("expiringPaperwork", async () => {
        const now = Date.now();
        let cutoff = new Date(now + (q.withinDays ?? EXPIRY_SOON_DAYS) * DAY);
        if (q.until) {
          const d = kit.parseDay(q.until);
          if (!d) return { error: `${q.until} is not a valid date. Use YYYY-MM-DD.` };
          cutoff = kit.nextDay(d);
        }
        const includeExpired = q.includeExpired ?? true;
        const { holders, scanLimited } = await loadPaperwork(kit, now);
        const items = holders
          .filter((h) => !q.owner || h.owner === q.owner)
          .flatMap((h) => h.papers
            .filter((p) => p.date && p.date < cutoff && (includeExpired || p.date.getTime() >= now))
            .map((p) => ({ h, p })))
          .sort((a, b) => a.p.date!.getTime() - b.p.date!.getTime())
          .map(({ h, p }) => ({ owner: h.owner, name: h.name, status: h.status, ...paperView(p, kit), state: p.date!.getTime() < now ? "expired" : "expiring", assigned: h.assigned, href: h.href }));
        const byOwner = items.reduce<Record<string, number>>((m, x) => { m[x.owner] = (m[x.owner] ?? 0) + 1; return m; }, {});
        return {
          asOf: kit.dateTime(new Date(now)), until: kit.date(new Date(cutoff.getTime() - 1)),
          expired: items.filter((x) => x.state === "expired").length, expiring: items.filter((x) => x.state === "expiring").length, byOwner,
          ...capped(items, "paperwork"),
          ...(scanLimited ? { scanLimit: `checked the first ${SCAN} units / drivers of each kind only` } : {}),
          ...(seesDrivers ? {} : { note: "driver paperwork is not available to this role" }),
          href: link("/maintenance?tab=compliance"),
        };
      }),
    }),

    complianceGaps: tool({
      description: "What is missing or wrong in paperwork, per truck, trailer and driver: required files not uploaded (registration, insurance, annual inspection for units; licence and medical for drivers), expired papers, papers without an expiry date, and critical cases (an active truck with expired paperwork, an active driver with an expired licence or medical still assigned to a truck, a driver on hold still assigned). Critical first.",
      inputSchema: z.object({ owner: z.enum(["truck", "trailer", "driver"]).optional() }),
      execute: (q) => safely("complianceGaps", async () => {
        const now = Date.now();
        const { holders, scanLimited } = await loadPaperwork(kit, now);
        const rows = holders
          .filter((h) => h.owner !== "company" && (!q.owner || h.owner === q.owner))
          .map((h) => {
            const issues: string[] = [];
            const critical: string[] = [];
            for (const p of h.papers) {
              if (p.required && !p.onFile) issues.push(p.state === "no date" ? `${p.label} not on file and no expiry date recorded` : `${p.label} not on file`);
              if (p.required && p.onFile && p.state === "no date") issues.push(`${p.label} on file without an expiry date`);
              if (p.state === "expired") {
                issues.push(`${p.label} expired ${-(p.days ?? 0)}d ago`);
                const what = p.label.toLowerCase();
                if (p.required && h.owner === "truck" && h.active) critical.push(`active truck with expired ${what}`);
                if (p.required && h.owner === "trailer" && h.active) critical.push(`trailer in use with expired ${what}`);
                if (p.required && h.owner === "driver" && h.active && h.assigned) critical.push(`expired ${what} while assigned to ${h.assigned}`);
              }
            }
            if (h.owner === "driver" && h.onHold && h.assigned) issues.push(`on hold but still assigned to ${h.assigned}`);
            return { owner: h.owner, name: h.name, status: h.status, assigned: h.assigned, critical, issues, href: h.href };
          })
          .filter((r) => r.issues.length || r.critical.length)
          .sort((a, b) => b.critical.length - a.critical.length || b.issues.length - a.issues.length || a.name.localeCompare(b.name));
        const checked = holders.filter((h) => h.owner !== "company" && (!q.owner || h.owner === q.owner));
        const of = (o: HolderType) => ({ withGaps: rows.filter((r) => r.owner === o).length, checked: checked.filter((h) => h.owner === o).length });
        return {
          asOf: kit.dateTime(new Date(now)),
          trucks: of("truck"), trailers: of("trailer"), ...(seesDrivers ? { drivers: of("driver") } : {}),
          criticalCount: rows.filter((r) => r.critical.length).length,
          ...capped(rows, "gaps"),
          ...(scanLimited ? { scanLimit: `checked the first ${SCAN} units / drivers of each kind only` } : {}),
          href: link("/maintenance?tab=compliance"),
        };
      }),
    }),

    fleetCosts: tool({
      description: `Distance, fuel and repair figures for a period (default: the last 90 days); for roles that see money also maintenance and fuel spend and cost ${L.perDistance}. Maintenance = completed repair orders by completion date; fuel = fuel fills; distance = odometer readings (fuel fills, repair orders, current odometer). groupBy truck (default): distance, fuel, ${L.economy}, repairs and (money) spend and cost ${L.perDistance} per truck, plus trailer repairs; repairType or vendor: the repair split; month: per calendar month (13 at most).`,
      inputSchema: z.object({
        from: dateText("First day, YYYY-MM-DD. Default: 90 days before `to`."),
        to: dateText("Last day (inclusive), YYYY-MM-DD. Default: today."),
        groupBy: z.enum(["truck", "repairType", "vendor", "month"]).optional(),
        sort: z.enum(["costPerDistance", "totalCost", "distance", "economy"]).optional().describe(`For groupBy truck. Default costPerDistance (highest first) for roles that see money, else distance. economy = worst ${L.economy} first.`),
      }),
      execute: (q) => safely("fleetCosts", async () => {
        const now = Date.now();
        const p = kit.resolvePeriod(q.from, q.to, now);
        if ("error" in p) return p;
        const woWhere: Prisma.WorkOrderWhereInput = { status: "DONE", voidedAt: null, completedAt: { gte: p.from, lt: p.to } };
        const fuelWhere: Prisma.FuelLogWhereInput = { date: { gte: p.from, lt: p.to } };
        const [jobs, fuelByTruck, km] = await Promise.all([
          db.workOrder.findMany({ where: woWhere, take: 50_000, select: { truckId: true, trailerId: true, repairType: true, vendor: true, vendorId: true, vendorRef: { select: { name: true } }, cost: true, invoiceTotal: true, completedAt: true } }),
          db.fuelLog.groupBy({ by: ["truckId"], where: fuelWhere, _sum: { cost: true, liters: true }, _count: true }),
          kmDriven(p.from, p.to),
        ]);
        const maint = new Map<string, { spend: number; jobs: number }>();
        for (const j of jobs) {
          if (!j.truckId) continue;
          const e = maint.get(j.truckId) ?? { spend: 0, jobs: 0 };
          e.spend += roAmount(j); e.jobs++;
          maint.set(j.truckId, e);
        }
        const fuel = new Map(fuelByTruck.map((g) => [g.truckId, { spend: g._sum.cost ?? 0, volume: g._sum.liters ?? 0, fills: g._count }]));
        const ids = [...new Set([...maint.keys(), ...fuel.keys(), ...[...km.byTruck].filter(([, v]) => v > 0).map(([k]) => k)])];
        const per = ids.map((id) => {
          const m = maint.get(id); const fl = fuel.get(id); const d = km.byTruck.get(id) ?? 0;
          return { id, distance: d, maintenance: m?.spend ?? 0, jobs: m?.jobs ?? 0, fuel: fl?.spend ?? 0, volume: fl?.volume ?? 0, fills: fl?.fills ?? 0 };
        });
        const otherJobs = jobs.filter((j) => !j.truckId);
        const withDistance = per.filter((r) => r.distance > 0);
        const distance = sumOf(withDistance, (r) => r.distance);
        const perDistance = (v: number) => (distance ? `${f.money2(v / distance)} ${L.perDistance}` : null);
        const measured = withDistance.filter((r) => r.volume > 0);
        const totals = {
          distance: f.dist(distance), fuel: f.vol(sumOf(per, (r) => r.volume)), fuelFills: sumOf(per, (r) => r.fills),
          fuelEconomy: f.economyText(f.economy(sumOf(measured, (r) => r.distance), sumOf(measured, (r) => r.volume))),
          repairsCompleted: jobs.length, trailerAndOtherRepairs: otherJobs.length,
          ...cash({
            truckMaintenance: f.money(sumOf(per, (r) => r.maintenance)), trailerAndOtherMaintenance: f.money(sumOf(otherJobs, roAmount)), fuelSpend: f.money(sumOf(per, (r) => r.fuel)),
            costPerDistance: perDistance(sumOf(withDistance, (r) => r.maintenance + r.fuel)),
            maintenancePerDistance: perDistance(sumOf(withDistance, (r) => r.maintenance)), fuelPerDistance: perDistance(sumOf(withDistance, (r) => r.fuel)),
            spendOnTrucksWithoutDistance: f.money(sumOf(per.filter((r) => r.distance === 0), (r) => r.maintenance + r.fuel)),
          }),
        };
        const base = {
          period: p.label, days: p.days, totals, href: link("/reports"), ...costsNote,
          note: `Cost ${L.perDistance} counts truck maintenance and fuel on trucks with distance in the period. Trucks with fewer than two odometer readings have no distance.`,
        };
        const groupBy = q.groupBy ?? "truck";

        if (groupBy === "repairType" || groupBy === "vendor") {
          const groups = new Map<string, { name: string; jobs: number; spend: number }>();
          for (const j of jobs) {
            const name = groupBy === "repairType" ? (REPAIR_TYPE_LABELS[j.repairType] ?? humanize(j.repairType)) : (j.vendorRef?.name ?? j.vendor ?? "No vendor recorded");
            const key = groupBy === "repairType" ? j.repairType : (j.vendorId ?? `name:${name.toLowerCase()}`);
            const e = groups.get(key) ?? { name, jobs: 0, spend: 0 };
            e.jobs++; e.spend += roAmount(j);
            groups.set(key, e);
          }
          const all = sumOf(jobs, roAmount);
          const rows = [...groups.values()]
            .sort((a, b) => (seesMoney ? b.spend - a.spend : 0) || b.jobs - a.jobs)
            .map((g) => ({ [groupBy]: g.name, repairs: g.jobs, ...cash({ spend: f.money(g.spend), sharePct: all ? round((g.spend / all) * 100) : 0 }) }));
          return { ...base, groupBy, ...capped(rows, groupBy === "repairType" ? "repairTypes" : "vendors"), href: link(groupBy === "vendor" ? "/vendors" : "/reports") };
        }

        if (groupBy === "month") {
          const start = zonedParts(new Date(p.from.getTime() + 12 * 3_600_000), kit.tz);
          const months: { key: string; from: Date; to: Date }[] = [];
          for (let i = 0; i < 14; i++) {
            const a = fromZoned(start.y, start.m + i, 1, 0, 0, kit.tz);
            if (a >= p.to) break;
            const b = fromZoned(start.y, start.m + i + 1, 1, 0, 0, kit.tz);
            months.push({ key: dayKey(new Date(a.getTime() + 12 * 3_600_000), kit.tz).slice(0, 7), from: a < p.from ? p.from : a, to: b > p.to ? p.to : b });
          }
          if (months.length > 13) return { error: "Pick 13 months or fewer for a monthly split." };
          const [fills, kms] = await Promise.all([
            db.fuelLog.findMany({ where: fuelWhere, select: { date: true, cost: true, liters: true }, take: 50_000 }),
            Promise.all(months.map((m) => kmDriven(m.from, m.to))),
          ]);
          const monthOf = (d: Date) => dayKey(d, kit.tz).slice(0, 7);
          const rows = months.map((m, i) => {
            const mj = jobs.filter((j) => j.completedAt && monthOf(j.completedAt) === m.key);
            const fs = fills.filter((x) => monthOf(x.date) === m.key);
            const maintenance = sumOf(mj, roAmount);
            const fuelSpend = sumOf(fs, (x) => x.cost);
            const d = kms[i].total;
            return {
              month: m.key, distance: f.dist(d), repairs: mj.length, fuel: f.vol(sumOf(fs, (x) => x.liters)),
              ...cash({ maintenance: f.money(maintenance), fuelSpend: f.money(fuelSpend), total: f.money(maintenance + fuelSpend), costPerDistance: d ? `${f.money2((maintenance + fuelSpend) / d)} ${L.perDistance}` : null }),
            };
          });
          return { ...base, groupBy, months: rows };
        }

        const trucks = await db.truck.findMany({ where: { id: { in: ids } }, select: { id: true, unitNumber: true, make: true, model: true, status: true } });
        const trailerJobs = otherJobs.filter((j) => j.trailerId);
        const unit = new Map(trucks.map((t) => [t.id, t]));
        const sort = q.sort ?? (seesMoney ? "costPerDistance" : "distance");
        const sortMoney = !seesMoney && (sort === "costPerDistance" || sort === "totalCost") ? "distance" : sort;
        const economyOf = (r: (typeof per)[number]) => f.economy(r.distance, r.volume);
        // Worst economy first: lowest MPG, or highest L/100 km.
        const worse = (a: number | null, b: number | null) => (a == null ? 1 : b == null ? -1 : L.economyHigherIsBetter ? a - b : b - a);
        const rows = [...per]
          .sort((a, b) =>
            sortMoney === "distance" ? b.distance - a.distance
              : sortMoney === "economy" ? worse(economyOf(a), economyOf(b))
                : sortMoney === "totalCost" ? (b.maintenance + b.fuel) - (a.maintenance + a.fuel)
                  : ((b.distance > 0 ? (b.maintenance + b.fuel) / b.distance : -1) - (a.distance > 0 ? (a.maintenance + a.fuel) / a.distance : -1)) || (b.maintenance + b.fuel) - (a.maintenance + a.fuel))
          .map((r) => {
            const t = unit.get(r.id);
            const total = r.maintenance + r.fuel;
            return {
              unit: t?.unitNumber ?? "Unknown truck", href: t ? link(`/fleet/${t.id}`) : undefined, vehicle: t ? `${t.make} ${t.model}` : null, status: t ? truckStatusLabel(t.status) : null,
              distance: f.dist(r.distance), fuel: f.vol(r.volume), fuelFills: r.fills, fuelEconomy: f.economyText(economyOf(r)), repairs: r.jobs,
              ...cash({
                maintenance: f.money(r.maintenance), fuelSpend: f.money(r.fuel), total: f.money(total),
                costPerDistance: r.distance > 0 ? `${f.money2(total / r.distance)} ${L.perDistance}` : null,
              }),
            };
          });
        const trailerIds = [...new Set(trailerJobs.map((j) => j.trailerId!))];
        const trailerUnits = trailerIds.length ? await db.trailer.findMany({ where: { id: { in: trailerIds } }, select: { id: true, unitNumber: true } }) : [];
        const trailerName = new Map(trailerUnits.map((t) => [t.id, t.unitNumber]));
        const trailers = trailerIds
          .map((id) => {
            const js = trailerJobs.filter((j) => j.trailerId === id);
            return { unit: trailerName.get(id) ?? "Unknown trailer", href: link(`/fleet/trailers/${id}`), repairs: js.length, spend: sumOf(js, roAmount) };
          })
          .sort((a, b) => b.spend - a.spend || b.repairs - a.repairs)
          .slice(0, 10)
          .map(({ spend, ...t }) => ({ ...t, ...cash({ maintenance: f.money(spend) }) }));
        return { ...base, groupBy, sort: sortMoney, ...capped(rows, "trucks"), trailerRepairs: trailers };
      }),
    }),

    listDrivers: tool({
      description: "List drivers (everyone except former drivers unless status=INACTIVE) with filters: employment status, type, hold (on hold, with the reason), hasTruck, expiringWithinDays (licence or medical expired or expiring within N days, soonest first), atRisk (safety score under 75, or licence / medical expired or expiring within 30 days), q (name, phone, licence number or dispatcher). Returns the total and up to 25 drivers with phone, dispatcher, truck, licence and medical dates, missing files, score, hold reason and repairs charged to them that they have not been told about.",
      inputSchema: z.object({
        status: z.enum(DRIVER_STATUSES).optional().describe("ACTIVE | ON_LEAVE | INACTIVE (former drivers)"),
        type: z.enum(DRIVER_TYPES).optional().describe("COMPANY | OWNER_OPERATOR | LEASE"),
        hold: z.boolean().optional().describe("true = only drivers on hold; false = only drivers not on hold"),
        hasTruck: z.boolean().optional().describe("true = only drivers with a truck assigned; false = only drivers without a truck"),
        expiringWithinDays: z.number().int().min(0).max(366).optional(),
        atRisk: z.boolean().optional(),
        q: filterText("Name, phone, licence number or dispatcher (case-insensitive contains)"),
      }),
      execute: (q) => safely("listDrivers", async () => {
        const now = Date.now();
        const soon = new Date(now + EXPIRY_SOON_DAYS * DAY);
        const cutoff = q.expiringWithinDays != null ? new Date(now + q.expiringWithinDays * DAY) : null;
        const where: Prisma.DriverWhereInput = {
          AND: [
            q.status ? { status: q.status } : { status: { not: "INACTIVE" } },
            q.type ? { type: q.type } : {},
            q.hold === true ? { hold: true } : q.hold === false ? { hold: false } : {},
            q.hasTruck === true ? { truck: { isNot: null } } : q.hasTruck === false ? { truck: { is: null } } : {},
            cutoff ? { OR: [{ licenseExpiry: { lte: cutoff } }, { medicalExpiry: { lte: cutoff } }] } : {},
            // Same rule as riskReasons(): "expiring within 30 days" includes already expired.
            q.atRisk ? { OR: [{ score: { lt: 75 } }, { licenseExpiry: { lte: soon } }, { medicalExpiry: { lte: soon } }] } : {},
            q.q ? { OR: [{ name: like(q.q) }, { phone: like(q.q) }, { phone2: like(q.q) }, { licenseNumber: like(q.q) }, { dispatcher: like(q.q) }] } : {},
          ],
        };
        const select = {
          id: true, name: true, phone: true, email: true, status: true, type: true, hold: true, holdReason: true, score: true, dispatcher: true,
          licenseClass: true, licenseExpiry: true, medicalExpiry: true, hireDate: true,
          truck: { select: { id: true, unitNumber: true } },
          documents: { where: { kind: { in: [...REQUIRED_DRIVER_DOCS] } }, select: { kind: true } },
          _count: { select: { charges: { where: { payer: "DRIVER", driverInformedAt: null, voidedAt: null, status: { not: "CANCELLED" } } } } },
        } satisfies Prisma.DriverSelect;
        // Expiring: soonest of licence and medical first, which needs both dates, so the matches are sorted in memory.
        const [total, found] = await Promise.all([
          db.driver.count({ where }),
          db.driver.findMany({ where, orderBy: { name: "asc" }, take: cutoff ? SCAN : LIMIT, select }),
        ]);
        const soonest = (d: (typeof found)[number]) => Math.min(d.licenseExpiry.getTime(), d.medicalExpiry?.getTime() ?? Infinity);
        const drivers = (cutoff ? [...found].sort((a, b) => soonest(a) - soonest(b)) : found).slice(0, LIMIT);
        return {
          filters: q, total, showing: drivers.length, truncated: total > drivers.length,
          drivers: drivers.map((x) => {
            const have = new Set(x.documents.map((d) => d.kind));
            return {
              name: x.name, href: link(`/drivers/${x.id}`), phone: x.phone, email: x.email, dispatcher: x.dispatcher,
              employment: humanize(x.status), type: kit.label(DRIVER_TYPE_LABELS, x.type),
              onHold: x.hold, holdReason: x.hold ? (x.holdReason ?? "no reason recorded") : null,
              truck: x.truck ? { unit: x.truck.unitNumber, href: link(`/fleet/${x.truck.id}`) } : null,
              licence: { class: x.licenseClass, expires: kit.date(x.licenseExpiry), daysLeft: daysUntil(x.licenseExpiry, now) },
              medical: { expires: kit.date(x.medicalExpiry), daysLeft: daysUntil(x.medicalExpiry, now) },
              missingFiles: REQUIRED_DRIVER_DOCS.filter((k) => !have.has(k)).map((k) => DOC_KIND_LABELS[k]),
              score: x.score, riskReasons: riskReasons(x, now), hired: kit.date(x.hireDate),
              chargesNotTold: x._count.charges,
            };
          }),
          href: link("/drivers"),
        };
      }),
    }),

    search: tool({
      description: "Free-text search across trucks (unit number, plate, VIN, make, model, group, location), trailers (unit number, plate, location), drivers (name, phone, licence number), repair orders (RO-0137, #137, title, vendor), vendors (name, phone, city), defects (DEF-0021, description) and roadside inspections (report number). Use when you do not know what kind of thing the user means. Up to 5 hits per kind.",
      inputSchema: z.object({ q: queryText("Search text") }),
      execute: ({ q }) => safely("search", async () => {
        const ro = /^(?:RO-?|#)?0*(\d{1,9})$/i.exec(q);
        const def = /^DEF-?0*(\d{1,9})$/i.exec(q);
        const [trucks, trailers, drivers, workOrders, vendors, defects, roadside] = await Promise.all([
          db.truck.findMany({
            where: { OR: [{ unitNumber: like(q) }, { plate: like(q) }, { vin: like(q) }, { make: like(q) }, { model: like(q) }, { group: like(q) }, { locationName: like(q) }] },
            take: 5, orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, make: true, model: true, plate: true, status: true, locationName: true, driver: { select: { name: true } } },
          }),
          db.trailer.findMany({
            where: { OR: [{ unitNumber: like(q) }, { plate: like(q) }, { locationName: like(q) }] },
            take: 5, orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, type: true, status: true, locationName: true, truck: { select: { unitNumber: true } } },
          }),
          seesDrivers
            ? db.driver.findMany({
              where: { OR: [{ name: like(q) }, { phone: like(q) }, { licenseNumber: like(q) }] },
              take: 5, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, status: true, hold: true, truck: { select: { unitNumber: true } } },
            })
            : Promise.resolve([]),
          db.workOrder.findMany({
            where: { OR: [...(ro ? [{ number: Number(ro[1]) }] : []), { title: like(q) }, { vendor: like(q) }, { vendorRef: { name: like(q) } }, { invoiceNumber: like(q) }] },
            take: 5, orderBy: { number: "desc" }, select: WO_ROW,
          }),
          db.vendor.findMany({ where: { OR: [{ name: like(q) }, { phone: like(q) }, { city: like(q) }] }, take: 5, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, phone: true, city: true } }),
          db.defect.findMany({ where: { OR: [...(def ? [{ number: Number(def[1]) }] : []), { description: like(q) }] }, take: 5, orderBy: { number: "desc" }, select: DEFECT_ROW }),
          db.roadsideInspection.findMany({ where: { reportNumber: like(q) }, take: 5, orderBy: { inspectedAt: "desc" }, select: { id: true, reportNumber: true, inspectedAt: true, result: true, ...UNIT_SELECT } }),
        ]);
        const now = Date.now();
        const today = f.startOfDay(new Date(now));
        return {
          query: q,
          trucks: trucks.map((x) => ({ unit: x.unitNumber, vehicle: `${x.make} ${x.model}`, plate: x.plate, status: truckStatusLabel(x.status), driver: seesDrivers ? (x.driver?.name ?? null) : undefined, location: x.locationName, href: link(`/fleet/${x.id}`) })),
          trailers: trailers.map((x) => ({ unit: x.unitNumber, type: kit.label(EQUIPMENT_LABELS, x.type), status: kit.label(TRAILER_STATUS_LABELS, x.status), pairedTruck: x.truck?.unitNumber ?? null, location: x.locationName, href: link(`/fleet/trailers/${x.id}`) })),
          drivers: drivers.map((x) => ({ name: x.name, phone: x.phone, employment: humanize(x.status), onHold: x.hold, truck: x.truck?.unitNumber ?? null, href: link(`/drivers/${x.id}`) })),
          repairOrders: workOrders.map((w) => woView(w, kit, now, today)),
          vendors: vendors.map((v) => ({ name: v.name, type: kit.label(VENDOR_TYPE_LABELS, v.type), phone: v.phone, city: v.city, href: link(`/vendors/${v.id}`) })),
          defects: defects.map((d) => defectView(d, kit, now)),
          roadsideInspections: roadside.map((r) => ({ reportNumber: r.reportNumber, date: kit.date(r.inspectedAt), result: kit.label(ROADSIDE_RESULT_LABELS, r.result), unit: unitView(r, kit), href: link(`/inspections/roadside/${r.id}`) })),
        };
      }),
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
