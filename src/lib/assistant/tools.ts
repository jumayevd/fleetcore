import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withCompany } from "@/lib/tenant";
import { kmDriven } from "@/lib/mileage";
import { can, canOpen, type Permission } from "@/lib/permissions";
import { DOC_KIND_LABELS, REQUIRED_DRIVER_DOCS, REQUIRED_UNIT_DOCS } from "@/lib/documents";
import {
  DRIVER_STATUSES, DRIVER_TYPES, DRIVER_TYPE_LABELS, EQUIPMENT, EQUIPMENT_LABELS, OWNERSHIP, OWNERSHIP_LABELS, TIMEZONE,
  TRAILER_STATUSES, TRAILER_STATUS_LABELS, TRUCK_STATUSES, WORK_ORDER_CATEGORIES, WORK_ORDER_CATEGORY_LABELS,
  WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, humanize,
} from "@/lib/constants";
import { TRAILER_POSITION_FIELDS, TRUCK_POSITION_FIELDS, lastSeen } from "./motion";

/*
 * Read-only lookups for the fleet assistant. Every query goes through the company-scoped `db`, and every tool runs
 * pinned to the company the request was authorised for (withCompany), so a tool can only ever see that company.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Hard cap on list sizes handed to the model. */
export const LIMIT = 25;
/** Hard ceiling on rows read for checks that run in memory (PM by odometer, paperwork, lease caps). */
const SCAN = 1000;
const DAY = 86_400_000;
/** Service due inside this many km is "due soon" (same rule as the fleet pages and alerts). */
const PM_DUE_SOON_KM = 2000;
/** Paperwork expiring inside this many days counts as expiring (same window as the fleet pages). */
const EXPIRY_SOON_DAYS = 30;
/** A leased truck this close to its hard cap is "near cap" (same rule as the truck page). */
const LEASE_NEAR_KM = 5000;
/** Work order states that still need doing; DRAFT and OPEN have not started yet. */
const ACTIVE_WO = ["DRAFT", "OPEN", "IN_PROGRESS"] as const;
const NOT_STARTED_WO = ["DRAFT", "OPEN"] as const;

const dtf = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const df = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, day: "2-digit", month: "short", year: "numeric" });
const ymdParts = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/** YYYY-MM-DD in the company timezone. */
function ymd(d: Date) {
  const parts = ymdParts.formatToParts(d);
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}
const fmtDateTime = (v: Date | null | undefined) => (v ? dtf.format(v) : null);
const fmtDate = (v: Date | null | undefined) => (v ? df.format(v) : null);
const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;
const daysUntil = (v: Date | null | undefined, now: number) => (v ? Math.ceil((v.getTime() - now) / DAY) : null);
const daysSince = (v: Date, now: number) => Math.max(0, Math.floor((now - v.getTime()) / DAY));
const labelOf = (map: Record<string, string>, v: string) => map[v] ?? humanize(v);
const truckStatusLabel = (s: string) => (s === "MAINTENANCE" ? "In shop" : humanize(s));
const like = (q: string) => ({ contains: q, mode: "insensitive" as const });
const exact = (q: string) => ({ equals: q, mode: "insensitive" as const });
const sumOf = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

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
/* Dates in the company timezone                                       */
/* ------------------------------------------------------------------ */

/** How far the company timezone is ahead of UTC at `at`, in ms. */
function zoneOffsetMs(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const n = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Midnight at the start of `ymd` (YYYY-MM-DD) in the company timezone; null when the date does not exist. */
function dayStart(ymd: string): Date | null {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return null;
  return new Date(utc.getTime() - zoneOffsetMs(utc));
}

const todayStart = (now: number) => dayStart(ymd(new Date(now)))!;

/** Optional inclusive day bounds as a Prisma date filter ({ gte, lt }). */
function dayBounds(fromYmd: string | undefined, toYmd: string | undefined): { gte?: Date; lt?: Date } | { error: string } {
  const gte = fromYmd ? dayStart(fromYmd) : undefined;
  const end = toYmd ? dayStart(toYmd) : undefined;
  if (gte === null) return { error: `${fromYmd} is not a valid date. Use YYYY-MM-DD.` };
  if (end === null) return { error: `${toYmd} is not a valid date. Use YYYY-MM-DD.` };
  const lt = end ? new Date(end.getTime() + DAY) : undefined;
  if (gte && lt && gte >= lt) return { error: "The start date must be on or before the end date." };
  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

type Period = { from: Date; to: Date; days: number; label: string };

/** [from, to) from inclusive YYYY-MM-DD days; default the `defaultDays` days up to and including today. */
function resolvePeriod(fromYmd: string | undefined, toYmd: string | undefined, now: number, defaultDays = 90): Period | { error: string } {
  const toDay = toYmd ? dayStart(toYmd) : todayStart(now);
  if (!toDay) return { error: `${toYmd} is not a valid date. Use YYYY-MM-DD.` };
  const to = new Date(toDay.getTime() + DAY);
  const from = fromYmd ? dayStart(fromYmd) : new Date(to.getTime() - defaultDays * DAY);
  if (!from) return { error: `${fromYmd} is not a valid date. Use YYYY-MM-DD.` };
  if (from >= to) return { error: "The start date must be on or before the end date." };
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  if (days > 1100) return { error: "Pick a period of three years or less." };
  return { from, to, days, label: `${fmtDate(from)} – ${fmtDate(new Date(to.getTime() - 1))}` };
}

/* ------------------------------------------------------------------ */
/* Fleet rules (same as the fleet and maintenance pages)               */
/* ------------------------------------------------------------------ */

const PM_FIELDS = { odometerKm: true, pmIntervalKm: true, lastPmKm: true, nextServiceKm: true } satisfies Prisma.TruckSelect;
type PmInput = { odometerKm: number; pmIntervalKm: number; lastPmKm: number | null; nextServiceKm: number | null };
type PmState = "overdue" | "due soon" | "ok" | "no PM data";

/** Next service = explicit nextServiceKm, else last PM + interval. kmLeft < 0 means overdue. */
function pmStatus(t: PmInput): { state: PmState; nextServiceKm: number | null; kmLeft: number | null } {
  const next = t.nextServiceKm ?? (t.lastPmKm != null ? t.lastPmKm + t.pmIntervalKm : null);
  if (next == null) return { state: "no PM data", nextServiceKm: null, kmLeft: null };
  const kmLeft = next - t.odometerKm;
  return { state: kmLeft < 0 ? "overdue" : kmLeft < PM_DUE_SOON_KM ? "due soon" : "ok", nextServiceKm: next, kmLeft };
}

const LEASE_FIELDS = {
  ownership: true, lessor: true, odometerKm: true, leaseStartKm: true, leaseAnnualLimitKm: true, leaseBufferPct: true, leaseOverageRate: true,
} satisfies Prisma.TruckSelect;
type LeaseInput = {
  ownership: string; lessor: string | null; odometerKm: number;
  leaseStartKm: number | null; leaseAnnualLimitKm: number | null; leaseBufferPct: number | null; leaseOverageRate: number | null;
};
type LeaseState = "over cap" | "in buffer" | "near cap" | "ok";

/** Hard cap = lease start + annual limit × (1 + buffer). Every km past it costs the overage rate. */
function leaseStatus(t: LeaseInput) {
  if (t.ownership !== "LEASED" || !t.leaseAnnualLimitKm) return null;
  const startKm = t.leaseStartKm ?? 0;
  const bufferPct = t.leaseBufferPct ?? 0;
  const allowedKm = startKm + t.leaseAnnualLimitKm;
  const hardCapKm = startKm + Math.round(t.leaseAnnualLimitKm * (1 + bufferPct / 100));
  const remainingKm = hardCapKm - t.odometerKm;
  const overKm = Math.max(0, -remainingKm);
  const state: LeaseState = overKm > 0 ? "over cap" : t.odometerKm > allowedKm ? "in buffer" : remainingKm < LEASE_NEAR_KM ? "near cap" : "ok";
  return {
    state, lessor: t.lessor, startKm, annualLimitKm: t.leaseAnnualLimitKm, bufferPct, allowedKm, hardCapKm,
    usedKm: Math.max(0, t.odometerKm - startKm), remainingKm, overKm,
    overageUsdPerKm: t.leaseOverageRate, exposureUsd: round(overKm * (t.leaseOverageRate ?? 0)),
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
/* Paperwork: record dates + uploaded files                            */
/* ------------------------------------------------------------------ */

type DocHit = { expiresAt: Date | null; name: string };
/** ownerId → kind (or "OTHER:<name>") → newest uploaded document. */
type DocIndex = Map<string, Map<string, DocHit>>;
const PAPER_KINDS = [...REQUIRED_UNIT_DOCS, ...REQUIRED_DRIVER_DOCS] as string[];
const docKey = (kind: string, name: string) => (kind === "OTHER" ? `OTHER:${name}` : kind);

/** Newest document per owner and kind: the required kinds, plus any other document that carries an expiry date. */
async function docIndex(owner: "truck" | "trailer" | "driver", ids?: string[]): Promise<DocIndex> {
  const scope: Prisma.DocumentWhereInput =
    owner === "truck" ? { truckId: ids ? { in: ids } : { not: null } }
      : owner === "trailer" ? { trailerId: ids ? { in: ids } : { not: null } }
        : { driverId: ids ? { in: ids } : { not: null } };
  const rows = await db.document.findMany({
    where: { ...scope, OR: [{ kind: { in: PAPER_KINDS } }, { expiresAt: { not: null } }] },
    orderBy: { createdAt: "desc" },
    take: 10_000,
    select: { truckId: true, trailerId: true, driverId: true, kind: true, name: true, expiresAt: true },
  });
  const index: DocIndex = new Map();
  for (const r of rows) {
    const id = owner === "truck" ? r.truckId : owner === "trailer" ? r.trailerId : r.driverId;
    if (!id) continue;
    let kinds = index.get(id);
    if (!kinds) index.set(id, (kinds = new Map()));
    const key = docKey(r.kind, r.name);
    if (!kinds.has(key)) kinds.set(key, { expiresAt: r.expiresAt, name: r.name });
  }
  return index;
}

type PaperState = "expired" | "expiring" | "ok" | "no date";
type Paper = {
  kind: string; label: string; required: boolean; onFile: boolean;
  record: Date | null; fileExpiry: Date | null; date: Date | null; days: number | null; state: PaperState;
};

/** A paper expires on the earlier of the record date and the newest file's expiry (same rule as the truck page). */
function paper(kind: string, record: Date | null, hit: DocHit | undefined, required: boolean, now: number): Paper {
  const fileExpiry = hit?.expiresAt ?? null;
  const date = record && fileExpiry ? (record < fileExpiry ? record : fileExpiry) : (record ?? fileExpiry);
  const days = daysUntil(date, now);
  const state: PaperState = days == null ? "no date" : days < 0 ? "expired" : days <= EXPIRY_SOON_DAYS ? "expiring" : "ok";
  const label = kind === "OTHER" && hit ? hit.name : (DOC_KIND_LABELS[kind] ?? humanize(kind));
  return { kind, label, required, onFile: Boolean(hit), record, fileExpiry, date, days, state };
}

/** Required papers (record date + newest file), then any other uploaded document that has an expiry date. */
function papersOf(required: readonly string[], records: Record<string, Date | null>, docs: Map<string, DocHit> | undefined, now: number): Paper[] {
  const out = required.map((kind) => paper(kind, records[kind] ?? null, docs?.get(kind), true, now));
  for (const [key, hit] of docs ?? []) {
    const kind = key.startsWith("OTHER:") ? "OTHER" : key;
    if (!required.includes(kind) && hit.expiresAt) out.push(paper(kind, null, hit, false, now));
  }
  return out;
}

const truckPapers = (t: { insuranceExpiry: Date | null; inspectionExpiry: Date | null; registrationExpiry: Date | null }, docs: Map<string, DocHit> | undefined, now: number) =>
  papersOf(REQUIRED_UNIT_DOCS, { REGISTRATION: t.registrationExpiry, INSURANCE: t.insuranceExpiry, INSPECTION: t.inspectionExpiry }, docs, now);
const trailerPapers = (t: { insuranceExpiry: Date | null; inspectionExpiry: Date | null }, docs: Map<string, DocHit> | undefined, now: number) =>
  papersOf(REQUIRED_UNIT_DOCS, { INSURANCE: t.insuranceExpiry, INSPECTION: t.inspectionExpiry }, docs, now);
const driverPapers = (d: { licenseExpiry: Date; medicalExpiry: Date | null }, docs: Map<string, DocHit> | undefined, now: number) =>
  papersOf(REQUIRED_DRIVER_DOCS, { LICENSE: d.licenseExpiry, MEDICAL: d.medicalExpiry }, docs, now);

function paperView(p: Paper) {
  const differs = p.record && p.fileExpiry && p.record.getTime() !== p.fileExpiry.getTime();
  return {
    paper: p.label, expires: fmtDate(p.date), daysLeft: p.days, state: p.state, fileOnRecord: p.onFile,
    ...(differs ? { recordDate: fmtDate(p.record), fileExpiry: fmtDate(p.fileExpiry) } : {}),
  };
}

/** Does this set of papers match a list filter? */
function papersMatch(papers: Paper[], f: "expired" | "expiring" | "expired_or_expiring" | "missing") {
  switch (f) {
    case "expired": return papers.some((p) => p.state === "expired");
    case "expiring": return papers.some((p) => p.state === "expiring");
    case "expired_or_expiring": return papers.some((p) => p.state === "expired" || p.state === "expiring");
    case "missing": return papers.some((p) => p.required && !p.onFile);
  }
}

type HolderType = "truck" | "trailer" | "driver" | "company";
/** Something that must keep paperwork: a truck, a trailer, a driver, or the company itself. */
type Holder = { owner: HolderType; id: string; name: string; status: string; active: boolean; assigned: string | null; onHold?: boolean; href: string | undefined; papers: Paper[] };

/** Every unit and driver still in use with its papers. Inactive trucks, out-of-service trailers and former drivers are left out. */
async function loadPaperwork(link: Linker, withDrivers: boolean, now: number) {
  const [trucks, trailers, drivers, truckDocs, trailerDocs, driverDocs, companyDocs] = await Promise.all([
    db.truck.findMany({
      where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" }, take: SCAN,
      select: { id: true, unitNumber: true, status: true, insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true, driver: { select: { name: true } } },
    }),
    db.trailer.findMany({
      where: { status: { not: "OUT_OF_SERVICE" } }, orderBy: { unitNumber: "asc" }, take: SCAN,
      select: { id: true, unitNumber: true, status: true, insuranceExpiry: true, inspectionExpiry: true, truck: { select: { unitNumber: true } } },
    }),
    withDrivers
      ? db.driver.findMany({
        where: { status: { not: "INACTIVE" } }, orderBy: { name: "asc" }, take: SCAN,
        select: { id: true, name: true, status: true, hold: true, licenseExpiry: true, medicalExpiry: true, truck: { select: { unitNumber: true } } },
      })
      : [],
    docIndex("truck"),
    docIndex("trailer"),
    withDrivers ? docIndex("driver") : new Map<string, Map<string, DocHit>>(),
    db.document.findMany({ where: { isCompany: true, expiresAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 500, select: { kind: true, name: true, expiresAt: true } }),
  ]);
  const holders: Holder[] = [
    ...trucks.map((t): Holder => ({
      owner: "truck", id: t.id, name: t.unitNumber, status: truckStatusLabel(t.status), active: t.status === "ACTIVE", assigned: t.driver?.name ?? null,
      href: link(`/fleet/${t.id}?tab=compliance`), papers: truckPapers(t, truckDocs.get(t.id), now),
    })),
    ...trailers.map((t): Holder => ({
      owner: "trailer", id: t.id, name: t.unitNumber, status: labelOf(TRAILER_STATUS_LABELS, t.status), active: t.status === "IN_USE", assigned: t.truck?.unitNumber ?? null,
      href: link(`/fleet/trailers/${t.id}`), papers: trailerPapers(t, trailerDocs.get(t.id), now),
    })),
    ...drivers.map((d): Holder => ({
      owner: "driver", id: d.id, name: d.name, status: humanize(d.status), active: d.status === "ACTIVE", assigned: d.truck?.unitNumber ?? null, onHold: d.hold,
      href: link(`/drivers/${d.id}?tab=documents`), papers: driverPapers(d, driverDocs.get(d.id), now),
    })),
  ];
  // Company documents: newest per kind (or per name for "Other"), only those with an expiry date.
  const seen = new Set<string>();
  const company: Paper[] = [];
  for (const d of companyDocs) {
    const key = docKey(d.kind, d.name);
    if (seen.has(key)) continue;
    seen.add(key);
    company.push(paper(d.kind, null, d, false, now));
  }
  if (company.length) holders.push({ owner: "company", id: "company", name: "Company documents", status: "—", active: true, assigned: null, href: undefined, papers: company });
  return { holders, scanLimited: trucks.length === SCAN || trailers.length === SCAN || drivers.length === SCAN };
}

/* ------------------------------------------------------------------ */
/* Row selects and views                                               */
/* ------------------------------------------------------------------ */

/** Keeps an href only when the role can open it; JSON drops `undefined`, so the key disappears. */
type Linker = (href: string) => string | undefined;

const TRUCK_ROW = {
  id: true, unitNumber: true, make: true, model: true, year: true, plate: true, vin: true, status: true, group: true,
  ...PM_FIELDS, ...LEASE_FIELDS, ...TRUCK_POSITION_FIELDS, lastPmAt: true,
  insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true,
  driver: { select: { id: true, name: true, phone: true, hold: true, holdReason: true } },
  trailers: { select: { id: true, unitNumber: true } },
  _count: { select: { workOrders: { where: { status: { in: [...ACTIVE_WO] } } } } },
} satisfies Prisma.TruckSelect;
type TruckRow = Prisma.TruckGetPayload<{ select: typeof TRUCK_ROW }>;

function truckView(t: TruckRow, docs: DocIndex, link: Linker, now: number) {
  const pm = pmStatus(t);
  return {
    unit: t.unitNumber, href: link(`/fleet/${t.id}`), vehicle: `${t.year} ${t.make} ${t.model}`, plate: t.plate, vin: t.vin,
    status: truckStatusLabel(t.status), ownership: labelOf(OWNERSHIP_LABELS, t.ownership), group: t.group,
    driver: t.driver ? { name: t.driver.name, phone: t.driver.phone, onHold: t.driver.hold, holdReason: t.driver.hold ? (t.driver.holdReason ?? "no reason recorded") : null, href: link(`/drivers/${t.driver.id}`) } : null,
    trailers: t.trailers.map((x) => ({ unit: x.unitNumber, href: link(`/fleet/trailers/${x.id}`) })),
    odometerKm: t.odometerKm,
    pm: { ...pm, intervalKm: t.pmIntervalKm, lastPmKm: t.lastPmKm, lastPmAt: fmtDate(t.lastPmAt) },
    paperwork: truckPapers(t, docs.get(t.id), now).map(paperView),
    lease: leaseStatus(t),
    lastSeen: lastSeen(t, now),
    openWorkOrders: t._count.workOrders,
  };
}

const TRAILER_ROW = {
  id: true, unitNumber: true, type: true, capacityKg: true, plate: true, year: true, status: true, statusSince: true,
  insuranceExpiry: true, inspectionExpiry: true, ...TRAILER_POSITION_FIELDS,
  truck: { select: { id: true, unitNumber: true } },
  _count: { select: { workOrders: { where: { status: { in: [...ACTIVE_WO] } } } } },
} satisfies Prisma.TrailerSelect;
type TrailerRow = Prisma.TrailerGetPayload<{ select: typeof TRAILER_ROW }>;

function trailerView(t: TrailerRow, docs: DocIndex, link: Linker, now: number) {
  return {
    unit: t.unitNumber, href: link(`/fleet/trailers/${t.id}`), type: labelOf(EQUIPMENT_LABELS, t.type), capacityKg: t.capacityKg, plate: t.plate, year: t.year,
    status: labelOf(TRAILER_STATUS_LABELS, t.status), since: fmtDate(t.statusSince), daysInStatus: daysSince(t.statusSince, now),
    pairedTruck: t.truck ? { unit: t.truck.unitNumber, href: link(`/fleet/${t.truck.id}`) } : null,
    paperwork: trailerPapers(t, docs.get(t.id), now).map(paperView),
    lastSeen: lastSeen(t, now),
    openWorkOrders: t._count.workOrders,
  };
}

const WO_ROW = {
  id: true, number: true, title: true, category: true, priority: true, status: true, vendor: true,
  scheduledAt: true, inAt: true, outAt: true, completedAt: true, odometerKm: true, laborCost: true, partsCost: true, cost: true,
  truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } },
} satisfies Prisma.WorkOrderSelect;
type WoRow = Prisma.WorkOrderGetPayload<{ select: typeof WO_ROW }>;

/** `today`: start of today in the company timezone; a draft / open job scheduled before it is overdue. */
function woView(w: WoRow, link: Linker, now: number, today: Date) {
  const notStarted = w.status === "DRAFT" || w.status === "OPEN";
  const overdueDays = notStarted && w.scheduledAt < today ? Math.ceil((today.getTime() - w.scheduledAt.getTime()) / DAY) : 0;
  const inShop = w.status === "IN_PROGRESS";
  return {
    workOrder: `#${w.number}`, href: link(`/maintenance/work-orders/${w.id}`), title: w.title,
    unit: w.truck ? { kind: "truck", unit: w.truck.unitNumber, href: link(`/fleet/${w.truck.id}`) }
      : w.trailer ? { kind: "trailer", unit: w.trailer.unitNumber, href: link(`/fleet/trailers/${w.trailer.id}`) } : null,
    category: labelOf(WORK_ORDER_CATEGORY_LABELS, w.category), priority: humanize(w.priority), status: humanize(w.status), vendor: w.vendor,
    scheduled: fmtDate(w.scheduledAt),
    ...(overdueDays ? { overdueDays } : {}),
    ...(inShop ? { inShopSince: fmtDate(w.inAt ?? w.scheduledAt), daysInShop: daysSince(w.inAt ?? w.scheduledAt, now) } : {}),
    ...(w.outAt ? { outOfShop: fmtDate(w.outAt) } : {}),
    ...(w.completedAt ? { completed: fmtDate(w.completedAt) } : {}),
    odometerKm: w.odometerKm,
    costUsd: round(w.cost), laborUsd: round(w.laborCost), partsUsd: round(w.partsCost),
  };
}

/* ------------------------------------------------------------------ */
/* Tool set                                                            */
/* ------------------------------------------------------------------ */

/** `companyId` is the company the request was authorised for; every tool runs pinned to it. */
export type ToolContext = { role: string; companyId: string };

/** Which permission each tool needs. Tools the role cannot use are not offered to the model at all. */
export const TOOL_PERMISSION = {
  fleetOverview: "fleet.view",
  listTrucks: "fleet.view",
  truckDetail: "fleet.view",
  listTrailers: "fleet.view",
  maintenanceDue: "fleet.view",
  workOrders: "fleet.view",
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
const WO_FILTERS = ["active", "overdue", "DRAFT", "OPEN", "IN_PROGRESS", "DONE", "CANCELLED", "all"] as const;

/**
 * Read-only tools, closed over the caller's role and company: none of them writes to the database. Every tool
 * re-checks its permission (a mis-routed call never leaks data, even though disallowed tools are not offered to the
 * model), runs pinned to the authorised company and contains its own errors.
 */
export function buildAssistantTools(ctx: ToolContext) {
  const link: Linker = (href) => (canOpen(ctx.role, href) ? href : undefined);
  const seesDrivers = can(ctx.role, "drivers.view");

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

  return {
    fleetOverview: tool({
      description: "Fleet snapshot right now: trucks by status, active trucks without a driver, PM overdue / due soon, leased trucks over or near their mileage cap, trailers by status, drivers working / on hold / on leave / with licence or medical problems, work orders open / in progress / overdue, units in the shop, and paperwork expired or expiring within 30 days. Use first for 'how is the fleet doing' or 'what needs attention'; then use the specific tool to name the units.",
      inputSchema: z.object({}),
      execute: () => safely("fleetOverview", async () => {
        const now = Date.now();
        const today = todayStart(now);
        const soon = new Date(now + EXPIRY_SOON_DAYS * DAY);
        const [byStatus, trucks, trailersByStatus, drivers, woByStatus, woOverdue, inShop, paperwork] = await Promise.all([
          db.truck.groupBy({ by: ["status"], _count: true }),
          db.truck.findMany({ where: { status: { not: "INACTIVE" } }, take: SCAN, select: { id: true, status: true, driverId: true, ...PM_FIELDS, ...LEASE_FIELDS } }),
          db.trailer.groupBy({ by: ["status"], _count: true }),
          db.driver.findMany({ where: { status: { not: "INACTIVE" } }, take: SCAN, select: { status: true, hold: true, licenseExpiry: true, medicalExpiry: true, truck: { select: { id: true } } } }),
          db.workOrder.groupBy({ by: ["status"], where: { status: { in: [...ACTIVE_WO] } }, _count: true }),
          db.workOrder.count({ where: { status: { in: [...NOT_STARTED_WO] }, scheduledAt: { lt: today } } }),
          db.workOrder.findMany({ where: { status: "IN_PROGRESS" }, select: { truckId: true, trailerId: true } }),
          loadPaperwork(link, seesDrivers, now),
        ]);
        const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
        const pm = trucks.map((t) => pmStatus(t).state);
        const lease = trucks.map((t) => leaseStatus(t)?.state);
        const papers = paperwork.holders.flatMap((h) => h.papers);
        const wo = (s: string) => woByStatus.find((r) => r.status === s)?._count ?? 0;
        const expiringPeople = (d: (typeof drivers)[number]) => d.licenseExpiry <= soon || (d.medicalExpiry != null && d.medicalExpiry <= soon);
        return {
          asOf: fmtDateTime(new Date(now)),
          trucks: {
            total: sumOf(byStatus, (r) => r._count),
            byStatus: Object.fromEntries(TRUCK_STATUSES.map((s) => [truckStatusLabel(s), byStatus.find((r) => r.status === s)?._count ?? 0])),
            activeWithoutDriver: count(trucks, (t) => t.status === "ACTIVE" && t.driverId == null),
            pmOverdue: count(pm, (s) => s === "overdue"), pmDueSoon: count(pm, (s) => s === "due soon"), noPmData: count(pm, (s) => s === "no PM data"),
            leaseOverCap: count(lease, (s) => s === "over cap"), leaseNearCap: count(lease, (s) => s === "near cap" || s === "in buffer"),
            href: link("/fleet"),
          },
          trailers: {
            total: sumOf(trailersByStatus, (r) => r._count),
            byStatus: Object.fromEntries(trailersByStatus.map((r) => [labelOf(TRAILER_STATUS_LABELS, r.status), r._count])),
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
          workOrders: {
            draft: wo("DRAFT"), open: wo("OPEN"), inProgress: wo("IN_PROGRESS"), overdue: woOverdue,
            unitsInShop: new Set(inShop.map((w) => w.truckId ?? w.trailerId).filter(Boolean)).size,
            href: link("/maintenance/work-orders"),
          },
          paperwork: {
            expired: count(papers, (p) => p.state === "expired"), expiringWithin30Days: count(papers, (p) => p.state === "expiring"),
            requiredFilesMissing: count(papers, (p) => p.required && !p.onFile),
            href: link("/maintenance?tab=compliance"),
          },
          ...(paperwork.scanLimited || trucks.length === SCAN ? { scanLimit: `checked the first ${SCAN} units / drivers only` } : {}),
          hints: {
            pm: "overdue = odometer past the next service km; due soon = within 2,000 km (maintenanceDue names them)",
            workOrdersOverdue: "draft or open work orders scheduled before today that have not started (workOrders status=overdue names them)",
            paperwork: "expiringPaperwork lists dates; complianceGaps lists missing files and expired papers per unit and driver",
          },
        };
      }),
    }),

    listTrucks: tool({
      description: "List trucks with filters: status, ownership, fleet group, make, hasDriver, pm (overdue / due_soon / no_data), paperwork (expired / expiring within 30 days / missing required file), lease (over_cap / near_or_over_cap). Inactive trucks are left out unless status=INACTIVE or includeInactive. Returns the total that match and up to 25 trucks with driver, paired trailers, odometer, PM status, paperwork dates, lease cap, last known location and open work orders.",
      inputSchema: z.object({
        status: z.enum(TRUCK_STATUSES).optional().describe("ACTIVE | MAINTENANCE (in shop) | OUT_OF_SERVICE | INACTIVE"),
        ownership: z.enum(OWNERSHIP).optional().describe("COMPANY | OWNER_OPERATOR | LEASED"),
        group: filterText("Fleet group / terminal (case-insensitive contains)"),
        make: filterText("Make such as Volvo, MAN or Scania (case-insensitive contains)"),
        hasDriver: z.boolean().optional().describe("true = only trucks with a driver assigned; false = only trucks with no driver"),
        pm: z.enum(["overdue", "due_soon", "overdue_or_due_soon", "no_data"]).optional().describe("Filter by PM status"),
        paperwork: PAPERWORK_FILTER.optional().describe("expired | expiring (within 30 days) | expired_or_expiring | missing (registration, insurance or inspection file not uploaded)"),
        lease: z.enum(["over_cap", "near_or_over_cap"]).optional().describe("Leased trucks over, or within 5,000 km of, their mileage hard cap"),
        includeInactive: z.boolean().optional(),
      }),
      execute: (f) => safely("listTrucks", async () => {
        const now = Date.now();
        const where: Prisma.TruckWhereInput = {
          AND: [
            f.status ? { status: f.status } : f.includeInactive ? {} : { status: { not: "INACTIVE" } },
            f.ownership ? { ownership: f.ownership } : {},
            f.lease ? { ownership: "LEASED", leaseAnnualLimitKm: { not: null } } : {},
            f.group ? { group: like(f.group) } : {},
            f.make ? { make: like(f.make) } : {},
            f.hasDriver === true ? { driverId: { not: null } } : f.hasDriver === false ? { driverId: null } : {},
          ],
        };
        const orderBy = { unitNumber: "asc" } as const;
        if (f.pm || f.paperwork || f.lease) {
          // PM, paperwork and lease caps are arithmetic over several fields, so they are checked in memory over a bounded scan.
          const scan = await db.truck.findMany({
            where, orderBy, take: SCAN,
            select: { id: true, ...PM_FIELDS, ...LEASE_FIELDS, insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true },
          });
          const docs = f.paperwork ? await docIndex("truck", scan.map((t) => t.id)) : new Map<string, Map<string, DocHit>>();
          const ids = scan.filter((t) => {
            const pm = pmStatus(t).state;
            if (f.pm === "overdue" && pm !== "overdue") return false;
            if (f.pm === "due_soon" && pm !== "due soon") return false;
            if (f.pm === "overdue_or_due_soon" && pm !== "overdue" && pm !== "due soon") return false;
            if (f.pm === "no_data" && pm !== "no PM data") return false;
            if (f.paperwork && !papersMatch(truckPapers(t, docs.get(t.id), now), f.paperwork)) return false;
            const lease = leaseStatus(t)?.state;
            if (f.lease === "over_cap" && lease !== "over cap") return false;
            if (f.lease === "near_or_over_cap" && (!lease || lease === "ok")) return false;
            return true;
          }).map((t) => t.id);
          const rows = await db.truck.findMany({ where: { id: { in: ids.slice(0, LIMIT) } }, orderBy, select: TRUCK_ROW });
          const rowDocs = await docIndex("truck", rows.map((t) => t.id));
          return {
            filters: f, total: ids.length, showing: rows.length, truncated: ids.length > rows.length,
            ...(scan.length === SCAN ? { scanLimit: `checked the first ${SCAN} trucks only` } : {}),
            trucks: rows.map((t) => truckView(t, rowDocs, link, now)),
            href: link("/fleet"),
          };
        }
        const [total, rows] = await Promise.all([db.truck.count({ where }), db.truck.findMany({ where, orderBy, take: LIMIT, select: TRUCK_ROW })]);
        const docs = await docIndex("truck", rows.map((t) => t.id));
        return { filters: f, total, showing: rows.length, truncated: total > rows.length, trucks: rows.map((t) => truckView(t, docs, link, now)), href: link("/fleet") };
      }),
    }),

    truckDetail: tool({
      description: "Open one truck by unit number (e.g. T-104), plate or VIN: status, driver, trailers, odometer, PM status and the PM work order if booked, paperwork with expiry dates and files on record, lease cap, last known location, open work orders, the last 5 completed jobs, maintenance and fuel spend, km driven and cost per km over the last 90 days, documents and recent notes. If several trucks match, returns the candidates instead.",
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
        const today = todayStart(now);
        const from = new Date(now - 90 * DAY);
        const [t, open, done, spend, fuel, km, docs, files] = await Promise.all([
          db.truck.findUniqueOrThrow({ where: { id }, select: { ...TRUCK_ROW, fuelType: true, fuelCapacityL: true, fuelEconomy: true, notes: true } }),
          db.workOrder.findMany({ where: { truckId: id, status: { in: [...ACTIVE_WO] } }, orderBy: { scheduledAt: "asc" }, take: 10, select: WO_ROW }),
          db.workOrder.findMany({ where: { truckId: id, status: "DONE" }, orderBy: { completedAt: "desc" }, take: 5, select: WO_ROW }),
          db.workOrder.aggregate({ where: { truckId: id, status: "DONE", completedAt: { gte: from } }, _sum: { cost: true }, _count: true }),
          db.fuelLog.aggregate({ where: { truckId: id, date: { gte: from } }, _sum: { cost: true, liters: true }, _count: true }),
          kmDriven(from, new Date(now), [id]),
          docIndex("truck", [id]),
          db.document.findMany({ where: { truckId: id }, orderBy: { createdAt: "desc" }, take: 15, select: { kind: true, name: true, expiresAt: true, createdAt: true } }),
        ]);
        const driven = km.byTruck.get(id) ?? 0;
        const maintenanceUsd = spend._sum.cost ?? 0;
        const fuelUsd = fuel._sum.cost ?? 0;
        const liters = fuel._sum.liters ?? 0;
        const pmJob = open.find((w) => w.category === "PM");
        const notes = (t.notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5).map((l) => (l.length > 200 ? `${l.slice(0, 197)}…` : l));
        return {
          found: true,
          ...truckView(t, docs, link, now),
          fuel: { type: humanize(t.fuelType), tankL: t.fuelCapacityL, economyLPer100km: t.fuelEconomy == null ? null : round(t.fuelEconomy, 1) },
          pmWorkOrder: pmJob ? { workOrder: `#${pmJob.number}`, status: humanize(pmJob.status), scheduled: fmtDate(pmJob.scheduledAt), href: link(`/maintenance/work-orders/${pmJob.id}`) } : null,
          openWorkOrders: open.map((w) => woView(w, link, now, today)),
          lastCompletedWorkOrders: done.map((w) => woView(w, link, now, today)),
          last90Days: {
            km: driven, maintenanceUsd: round(maintenanceUsd), workOrdersDone: spend._count, fuelUsd: round(fuelUsd), fuelLiters: round(liters), fuelFills: fuel._count,
            costPerKm: driven > 0 ? round((maintenanceUsd + fuelUsd) / driven, 2) : null,
            litersPer100km: driven > 0 && liters > 0 ? round((liters / driven) * 100, 1) : null,
            ...(driven === 0 ? { note: "no km: fewer than two odometer readings in the last 90 days" } : {}),
          },
          documents: files.map((d) => ({ kind: labelOf(DOC_KIND_LABELS, d.kind), name: d.name, expires: fmtDate(d.expiresAt), uploaded: fmtDate(d.createdAt) })),
          recentNotes: notes,
          pages: { compliance: link(`/fleet/${id}?tab=compliance`), maintenance: link(`/fleet/${id}?tab=maintenance`) },
        };
      }),
    }),

    listTrailers: tool({
      description: "List trailers with filters: status, body type, paired (hooked to a truck or not), paperwork (expired / expiring / missing file), q (unit number or plate). Returns the total that match and up to 25 trailers with type, capacity, status and days in it, paired truck, insurance and inspection dates, last known location and open work orders.",
      inputSchema: z.object({
        status: z.enum(TRAILER_STATUSES).optional().describe("IN_USE | EMPTY | DROPPED | YARD | SHOP | OUT_OF_SERVICE"),
        type: z.enum(EQUIPMENT).optional().describe("DRY_VAN | REEFER | FLATBED | TANKER | CONTAINER"),
        paired: z.boolean().optional().describe("true = hooked to a truck; false = not paired"),
        paperwork: PAPERWORK_FILTER.optional(),
        q: filterText("Unit number or plate (case-insensitive contains)"),
      }),
      execute: (f) => safely("listTrailers", async () => {
        const now = Date.now();
        const where: Prisma.TrailerWhereInput = {
          AND: [
            f.status ? { status: f.status } : {},
            f.type ? { type: f.type } : {},
            f.paired === true ? { truckId: { not: null } } : f.paired === false ? { truckId: null } : {},
            f.q ? { OR: [{ unitNumber: like(f.q) }, { plate: like(f.q) }] } : {},
          ],
        };
        const orderBy = { unitNumber: "asc" } as const;
        if (f.paperwork) {
          const scan = await db.trailer.findMany({ where, orderBy, take: SCAN, select: { id: true, insuranceExpiry: true, inspectionExpiry: true } });
          const docs = await docIndex("trailer", scan.map((t) => t.id));
          const ids = scan.filter((t) => papersMatch(trailerPapers(t, docs.get(t.id), now), f.paperwork!)).map((t) => t.id);
          const rows = await db.trailer.findMany({ where: { id: { in: ids.slice(0, LIMIT) } }, orderBy, select: TRAILER_ROW });
          return {
            filters: f, total: ids.length, showing: rows.length, truncated: ids.length > rows.length,
            ...(scan.length === SCAN ? { scanLimit: `checked the first ${SCAN} trailers only` } : {}),
            trailers: rows.map((t) => trailerView(t, docs, link, now)), href: link("/fleet/trailers"),
          };
        }
        const [total, rows] = await Promise.all([db.trailer.count({ where }), db.trailer.findMany({ where, orderBy, take: LIMIT, select: TRAILER_ROW })]);
        const docs = await docIndex("trailer", rows.map((t) => t.id));
        return { filters: f, total, showing: rows.length, truncated: total > rows.length, trailers: rows.map((t) => trailerView(t, docs, link, now)), href: link("/fleet/trailers") };
      }),
    }),

    maintenanceDue: tool({
      description: "Trucks overdue or due for PM by odometer (next service km minus current km), most overdue first, each with the PM work order if one is already booked. withinKm defaults to 2000. Answers 'which trucks are overdue for PM'.",
      inputSchema: z.object({ withinKm: z.number().int().min(0).max(100_000).optional().describe("Include trucks with service due inside this many km (default 2000). Overdue trucks are always included.") }),
      execute: ({ withinKm }) => safely("maintenanceDue", async () => {
        const horizon = withinKm ?? PM_DUE_SOON_KM;
        const [trucks, openPm] = await Promise.all([
          // Service due is odometer arithmetic, so it is checked in memory over a bounded scan of light rows.
          db.truck.findMany({
            where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" }, take: SCAN,
            select: { id: true, unitNumber: true, make: true, model: true, year: true, status: true, locationName: true, lastPmAt: true, ...PM_FIELDS, driver: { select: { name: true } } },
          }),
          db.workOrder.findMany({ where: { category: "PM", status: { in: [...ACTIVE_WO] }, truckId: { not: null } }, orderBy: { scheduledAt: "asc" }, select: { id: true, number: true, status: true, scheduledAt: true, vendor: true, truckId: true } }),
        ]);
        const booked = new Map<string, (typeof openPm)[number]>();
        for (const w of openPm) if (w.truckId && !booked.has(w.truckId)) booked.set(w.truckId, w);
        const due = trucks
          .map((t) => ({ t, pm: pmStatus(t) }))
          .filter(({ pm }) => pm.kmLeft != null && pm.kmLeft < horizon)
          .sort((a, b) => (a.pm.kmLeft ?? 0) - (b.pm.kmLeft ?? 0))
          .map(({ t, pm }) => {
            const w = booked.get(t.id);
            return {
              unit: t.unitNumber, href: link(`/fleet/${t.id}`), vehicle: `${t.year} ${t.make} ${t.model}`, status: truckStatusLabel(t.status), driver: t.driver?.name ?? null,
              odometerKm: t.odometerKm, nextServiceKm: pm.nextServiceKm, kmLeft: pm.kmLeft, state: pm.state, lastPmAt: fmtDate(t.lastPmAt), location: t.locationName,
              pmWorkOrder: w ? { workOrder: `#${w.number}`, status: humanize(w.status), scheduled: fmtDate(w.scheduledAt), vendor: w.vendor, href: link(`/maintenance/work-orders/${w.id}`) } : null,
            };
          });
        return {
          withinKm: horizon, overdue: due.filter((t) => t.state === "overdue").length, dueSoon: due.filter((t) => t.state === "due soon").length,
          notBooked: due.filter((t) => !t.pmWorkOrder).length,
          noPmData: trucks.filter((t) => pmStatus(t).state === "no PM data").length,
          ...capped(due, "trucks"),
          ...(trucks.length === SCAN ? { scanLimit: `checked the first ${SCAN} trucks only` } : {}),
          href: link("/maintenance?tab=pm"),
        };
      }),
    }),

    workOrders: tool({
      description: "Work orders (shop jobs, #number) with filters. status: active (draft, open or in progress; default), overdue (draft or open, scheduled before today, not started), DRAFT, OPEN, IN_PROGRESS (in the shop now), DONE, CANCELLED, all. Also unit (truck or trailer unit number), category, priority, vendor, and a date range (completion date for DONE, scheduled date otherwise). Returns the total, cost totals (labour, parts, total) and up to 25 jobs with unit, status, dates, days in shop or overdue, vendor and costs.",
      inputSchema: z.object({
        status: z.enum(WO_FILTERS).optional(),
        unit: filterText("Truck or trailer unit number"),
        category: z.enum(WORK_ORDER_CATEGORIES).optional().describe("PM | ENGINE | COOLING | TIRES | BRAKES | ELECTRICAL | BODY | TOWING | INSPECTION | OTHER"),
        priority: z.enum(WORK_ORDER_PRIORITIES).optional().describe("LOW | MEDIUM | HIGH | URGENT"),
        vendor: filterText("Vendor / shop name (case-insensitive contains)"),
        from: dateText("First day, YYYY-MM-DD"),
        to: dateText("Last day (inclusive), YYYY-MM-DD"),
      }),
      execute: (f) => safely("workOrders", async () => {
        const now = Date.now();
        const today = todayStart(now);
        const s = f.status ?? "active";
        let unitIds: string[] = [];
        if (f.unit) {
          const units = await findUnits(f.unit);
          if (!units.trucks.length && !units.trailers.length) return { found: false, message: `No truck or trailer matches "${f.unit}".` };
          unitIds = [...units.trucks, ...units.trailers].map((u) => u.id);
        }
        let range: Prisma.WorkOrderWhereInput = {};
        if (f.from || f.to) {
          const b = dayBounds(f.from, f.to);
          if ("error" in b) return b;
          range = s === "DONE" ? { completedAt: b } : { scheduledAt: b };
        }
        const where: Prisma.WorkOrderWhereInput = {
          AND: [
            s === "active" ? { status: { in: [...ACTIVE_WO] } }
              : s === "overdue" ? { status: { in: [...NOT_STARTED_WO] }, scheduledAt: { lt: today } }
                : s === "all" ? {} : { status: s },
            unitIds.length ? { OR: [{ truckId: { in: unitIds } }, { trailerId: { in: unitIds } }] } : {},
            f.category ? { category: f.category } : {},
            f.priority ? { priority: f.priority } : {},
            f.vendor ? { vendor: like(f.vendor) } : {},
            range,
          ],
        };
        const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] =
          s === "DONE" ? [{ completedAt: "desc" }, { number: "desc" }]
            : s === "CANCELLED" || s === "all" ? [{ scheduledAt: "desc" }, { number: "desc" }]
              : [{ scheduledAt: "asc" }, { number: "asc" }];
        const [agg, rows] = await Promise.all([
          db.workOrder.aggregate({ where, _count: true, _sum: { cost: true, laborCost: true, partsCost: true } }),
          db.workOrder.findMany({ where, orderBy, take: LIMIT, select: WO_ROW }),
        ]);
        const params = new URLSearchParams();
        if ((WORK_ORDER_STATUSES as readonly string[]).includes(s) || s === "all") params.set("status", s);
        if (unitIds.length === 1) params.set("unit", unitIds[0]);
        if (f.category) params.set("category", f.category);
        if (f.priority) params.set("priority", f.priority);
        const qs = params.toString();
        return {
          filters: f, total: agg._count, showing: rows.length, truncated: agg._count > rows.length,
          totals: { costUsd: round(agg._sum.cost ?? 0), laborUsd: round(agg._sum.laborCost ?? 0), partsUsd: round(agg._sum.partsCost ?? 0) },
          workOrders: rows.map((w) => woView(w, link, now, today)),
          href: link(`/maintenance/work-orders${qs ? `?${qs}` : ""}`),
        };
      }),
    }),

    expiringPaperwork: tool({
      description: "Paperwork that expires soon or has expired, soonest first: truck registration, insurance and technical inspection, trailer insurance, inspection and registration, driver licences and medical certificates, plus any other uploaded document with an expiry date (permits, leases, contracts, company documents). Default window: the next 30 days, expired included. For 'this month' pass until = the last day of the month.",
      inputSchema: z.object({
        withinDays: z.number().int().min(0).max(366).optional().describe("Expiring within this many days from now (default 30)"),
        until: dateText("Or: expiring on or before this day, YYYY-MM-DD. Wins over withinDays."),
        includeExpired: z.boolean().optional().describe("Include paperwork that has already expired (default true)"),
        owner: z.enum(["truck", "trailer", "driver", "company"]).optional(),
      }),
      execute: (f) => safely("expiringPaperwork", async () => {
        const now = Date.now();
        let cutoff = new Date(now + (f.withinDays ?? EXPIRY_SOON_DAYS) * DAY);
        if (f.until) {
          const d = dayStart(f.until);
          if (!d) return { error: `${f.until} is not a valid date. Use YYYY-MM-DD.` };
          cutoff = new Date(d.getTime() + DAY);
        }
        const includeExpired = f.includeExpired ?? true;
        const { holders, scanLimited } = await loadPaperwork(link, seesDrivers, now);
        const items = holders
          .filter((h) => !f.owner || h.owner === f.owner)
          .flatMap((h) => h.papers
            .filter((p) => p.date && p.date < cutoff && (includeExpired || p.date.getTime() >= now))
            .map((p) => ({ h, p })))
          .sort((a, b) => a.p.date!.getTime() - b.p.date!.getTime())
          .map(({ h, p }) => ({ owner: h.owner, name: h.name, status: h.status, ...paperView(p), state: p.date!.getTime() < now ? "expired" : "expiring", assigned: h.assigned, href: h.href }));
        const byOwner = items.reduce<Record<string, number>>((m, x) => { m[x.owner] = (m[x.owner] ?? 0) + 1; return m; }, {});
        return {
          asOf: fmtDateTime(new Date(now)), until: fmtDate(new Date(cutoff.getTime() - 1)),
          expired: items.filter((x) => x.state === "expired").length, expiring: items.filter((x) => x.state === "expiring").length, byOwner,
          ...capped(items, "paperwork"),
          ...(scanLimited ? { scanLimit: `checked the first ${SCAN} units / drivers of each kind only` } : {}),
          ...(seesDrivers ? {} : { note: "driver paperwork is not available to this role" }),
          href: link("/maintenance?tab=compliance"),
        };
      }),
    }),

    complianceGaps: tool({
      description: "What is missing or wrong in paperwork, per truck, trailer and driver: required files not uploaded (registration, insurance, inspection for units; licence and medical for drivers), expired papers, papers without an expiry date, and critical cases (an active truck with expired paperwork, an active driver with an expired licence or medical still assigned to a truck, a driver on hold still assigned). Critical first.",
      inputSchema: z.object({ owner: z.enum(["truck", "trailer", "driver"]).optional() }),
      execute: (f) => safely("complianceGaps", async () => {
        const now = Date.now();
        const { holders, scanLimited } = await loadPaperwork(link, seesDrivers, now);
        const rows = holders
          .filter((h) => h.owner !== "company" && (!f.owner || h.owner === f.owner))
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
        const checked = holders.filter((h) => h.owner !== "company" && (!f.owner || h.owner === f.owner));
        const of = (o: HolderType) => ({ withGaps: rows.filter((r) => r.owner === o).length, checked: checked.filter((h) => h.owner === o).length });
        return {
          asOf: fmtDateTime(new Date(now)),
          trucks: of("truck"), trailers: of("trailer"), ...(seesDrivers ? { drivers: of("driver") } : {}),
          criticalCount: rows.filter((r) => r.critical.length).length,
          ...capped(rows, "gaps"),
          ...(scanLimited ? { scanLimit: `checked the first ${SCAN} units / drivers of each kind only` } : {}),
          href: link("/maintenance?tab=compliance"),
        };
      }),
    }),

    fleetCosts: tool({
      description: "Maintenance and fuel spend and cost per km for a period (default: the last 90 days). Maintenance = completed work orders by completion date; fuel = fuel fills; km = odometer readings (fuel fills, work orders, current odometer). groupBy truck (default): km, maintenance, fuel, total, cost per km and litres per 100 km per truck, plus trailer maintenance; category or vendor: maintenance split; month: spend and km per month (13 months at most).",
      inputSchema: z.object({
        from: dateText("First day, YYYY-MM-DD. Default: 90 days before `to`."),
        to: dateText("Last day (inclusive), YYYY-MM-DD. Default: today."),
        groupBy: z.enum(["truck", "category", "vendor", "month"]).optional(),
        sort: z.enum(["costPerKm", "totalCost", "km"]).optional().describe("For groupBy truck. Default costPerKm, highest first."),
      }),
      execute: (f) => safely("fleetCosts", async () => {
        const now = Date.now();
        const p = resolvePeriod(f.from, f.to, now);
        if ("error" in p) return p;
        const woWhere: Prisma.WorkOrderWhereInput = { status: "DONE", completedAt: { gte: p.from, lt: p.to } };
        const fuelWhere: Prisma.FuelLogWhereInput = { date: { gte: p.from, lt: p.to } };
        const [woByTruck, fuelByTruck, km] = await Promise.all([
          db.workOrder.groupBy({ by: ["truckId"], where: woWhere, _sum: { cost: true }, _count: true }),
          db.fuelLog.groupBy({ by: ["truckId"], where: fuelWhere, _sum: { cost: true, liters: true }, _count: true }),
          kmDriven(p.from, p.to),
        ]);
        const maint = new Map(woByTruck.filter((g) => g.truckId).map((g) => [g.truckId!, { usd: g._sum.cost ?? 0, jobs: g._count }]));
        const fuel = new Map(fuelByTruck.map((g) => [g.truckId, { usd: g._sum.cost ?? 0, liters: g._sum.liters ?? 0, fills: g._count }]));
        const ids = [...new Set([...maint.keys(), ...fuel.keys(), ...[...km.byTruck].filter(([, v]) => v > 0).map(([k]) => k)])];
        const per = ids.map((id) => {
          const m = maint.get(id); const fl = fuel.get(id); const d = km.byTruck.get(id) ?? 0;
          return { id, km: d, maintenanceUsd: m?.usd ?? 0, jobs: m?.jobs ?? 0, fuelUsd: fl?.usd ?? 0, liters: fl?.liters ?? 0, fills: fl?.fills ?? 0 };
        });
        const truckMaintenance = sumOf(per, (r) => r.maintenanceUsd);
        const otherMaintenance = woByTruck.find((g) => g.truckId == null)?._sum.cost ?? 0;
        const fuelUsd = sumOf(per, (r) => r.fuelUsd);
        const withKm = per.filter((r) => r.km > 0);
        const kmTotal = sumOf(withKm, (r) => r.km);
        const costWithKm = sumOf(withKm, (r) => r.maintenanceUsd + r.fuelUsd);
        const litersWithKm = sumOf(withKm, (r) => r.liters);
        const totals = {
          km: kmTotal, truckMaintenanceUsd: round(truckMaintenance), trailerAndOtherMaintenanceUsd: round(otherMaintenance), fuelUsd: round(fuelUsd),
          fuelLiters: round(sumOf(per, (r) => r.liters)), workOrdersDone: sumOf(woByTruck, (g) => g._count), fuelFills: sumOf(per, (r) => r.fills),
          costPerKm: kmTotal ? round(costWithKm / kmTotal, 2) : null,
          maintenancePerKm: kmTotal ? round(sumOf(withKm, (r) => r.maintenanceUsd) / kmTotal, 2) : null,
          fuelPerKm: kmTotal ? round(sumOf(withKm, (r) => r.fuelUsd) / kmTotal, 2) : null,
          litersPer100km: kmTotal && litersWithKm ? round((litersWithKm / kmTotal) * 100, 1) : null,
          truckCostWithoutKmUsd: round(sumOf(per.filter((r) => r.km === 0), (r) => r.maintenanceUsd + r.fuelUsd)),
        };
        const base = {
          period: p.label, days: p.days, totals, href: link("/reports"),
          note: "Cost per km counts truck maintenance and fuel on trucks with km in the period. Trucks with fewer than two odometer readings have no km; their spend is in truckCostWithoutKmUsd.",
        };
        const groupBy = f.groupBy ?? "truck";

        if (groupBy === "category" || groupBy === "vendor") {
          const groups = groupBy === "category"
            ? (await db.workOrder.groupBy({ by: ["category"], where: woWhere, _sum: { cost: true }, _count: true })).map((g) => ({ name: labelOf(WORK_ORDER_CATEGORY_LABELS, g.category), usd: g._sum.cost ?? 0, jobs: g._count }))
            : (await db.workOrder.groupBy({ by: ["vendor"], where: woWhere, _sum: { cost: true }, _count: true })).map((g) => ({ name: g.vendor ?? "No vendor recorded", usd: g._sum.cost ?? 0, jobs: g._count }));
          const all = truckMaintenance + otherMaintenance;
          const rows = groups.sort((a, b) => b.usd - a.usd).map((g) => ({ [groupBy]: g.name, workOrders: g.jobs, costUsd: round(g.usd), sharePct: all ? round((g.usd / all) * 100) : 0 }));
          return { ...base, groupBy, ...capped(rows, groupBy === "category" ? "categories" : "vendors"), href: link("/maintenance") };
        }

        if (groupBy === "month") {
          const months: { key: string; from: Date; to: Date }[] = [];
          let cursor = ymd(p.from).slice(0, 7);
          for (let i = 0; i < 14; i++) {
            const [y, m] = cursor.split("-").map(Number);
            const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
            const start = dayStart(`${cursor}-01`)!;
            if (start >= p.to) break;
            const end = dayStart(`${next}-01`)!;
            months.push({ key: cursor, from: start < p.from ? p.from : start, to: end > p.to ? p.to : end });
            cursor = next;
          }
          if (months.length > 13) return { error: "Pick 13 months or fewer for a monthly split." };
          const [jobs, fills, kms] = await Promise.all([
            db.workOrder.findMany({ where: woWhere, select: { completedAt: true, cost: true }, take: 20_000 }),
            db.fuelLog.findMany({ where: fuelWhere, select: { date: true, cost: true, liters: true }, take: 50_000 }),
            Promise.all(months.map((m) => kmDriven(m.from, m.to))),
          ]);
          const monthOf = (d: Date) => ymd(d).slice(0, 7);
          const rows = months.map((m, i) => {
            const maintenanceUsd = sumOf(jobs.filter((j) => j.completedAt && monthOf(j.completedAt) === m.key), (j) => j.cost);
            const fs = fills.filter((x) => monthOf(x.date) === m.key);
            const fuelMonth = sumOf(fs, (x) => x.cost);
            const kmMonth = kms[i].total;
            return {
              month: m.key, km: kmMonth, maintenanceUsd: round(maintenanceUsd), fuelUsd: round(fuelMonth), totalUsd: round(maintenanceUsd + fuelMonth),
              costPerKm: kmMonth ? round((maintenanceUsd + fuelMonth) / kmMonth, 2) : null,
            };
          });
          return { ...base, groupBy, months: rows };
        }

        const [trucks, trailerJobs] = await Promise.all([
          db.truck.findMany({ where: { id: { in: ids } }, select: { id: true, unitNumber: true, make: true, model: true, status: true } }),
          db.workOrder.groupBy({ by: ["trailerId"], where: { ...woWhere, truckId: null, trailerId: { not: null } }, _sum: { cost: true }, _count: true }),
        ]);
        const unit = new Map(trucks.map((t) => [t.id, t]));
        const sort = f.sort ?? "costPerKm";
        const rows = per
          .map((r) => {
            const t = unit.get(r.id);
            const total = r.maintenanceUsd + r.fuelUsd;
            return {
              unit: t?.unitNumber ?? "Unknown truck", href: t ? link(`/fleet/${t.id}`) : undefined, vehicle: t ? `${t.make} ${t.model}` : null, status: t ? truckStatusLabel(t.status) : null,
              km: r.km, maintenanceUsd: round(r.maintenanceUsd), fuelUsd: round(r.fuelUsd), totalUsd: round(total),
              costPerKm: r.km > 0 ? round(total / r.km, 2) : null, maintenancePerKm: r.km > 0 ? round(r.maintenanceUsd / r.km, 2) : null,
              fuelPerKm: r.km > 0 ? round(r.fuelUsd / r.km, 2) : null, litersPer100km: r.km > 0 && r.liters > 0 ? round((r.liters / r.km) * 100, 1) : null,
              workOrders: r.jobs, fuelFills: r.fills,
            };
          })
          .sort((a, b) =>
            sort === "km" ? b.km - a.km
              : sort === "totalCost" ? b.totalUsd - a.totalUsd
                : (b.costPerKm ?? -1) - (a.costPerKm ?? -1) || b.totalUsd - a.totalUsd);
        const trailerUnits = trailerJobs.length
          ? await db.trailer.findMany({ where: { id: { in: trailerJobs.map((g) => g.trailerId!) } }, select: { id: true, unitNumber: true } })
          : [];
        const trailerName = new Map(trailerUnits.map((t) => [t.id, t.unitNumber]));
        const trailers = trailerJobs
          .map((g) => ({ unit: trailerName.get(g.trailerId!) ?? "Unknown trailer", href: link(`/fleet/trailers/${g.trailerId}`), maintenanceUsd: round(g._sum.cost ?? 0), workOrders: g._count }))
          .sort((a, b) => b.maintenanceUsd - a.maintenanceUsd)
          .slice(0, 10);
        return { ...base, groupBy, sort, ...capped(rows, "trucks"), trailerMaintenance: trailers };
      }),
    }),

    listDrivers: tool({
      description: "List drivers (everyone except former drivers unless status=INACTIVE) with filters: employment status, type, hold (on hold, with the reason), hasTruck, expiringWithinDays (licence or medical expired or expiring within N days, soonest first), atRisk (safety score under 75, or licence / medical expired or expiring within 30 days), q (name, phone or licence number). Returns the total and up to 25 drivers with phone, truck, licence and medical dates, missing files, score and hold reason.",
      inputSchema: z.object({
        status: z.enum(DRIVER_STATUSES).optional().describe("ACTIVE | ON_LEAVE | INACTIVE (former drivers)"),
        type: z.enum(DRIVER_TYPES).optional().describe("COMPANY | OWNER_OPERATOR | LEASE"),
        hold: z.boolean().optional().describe("true = only drivers on hold; false = only drivers not on hold"),
        hasTruck: z.boolean().optional().describe("true = only drivers with a truck assigned; false = only drivers without a truck"),
        expiringWithinDays: z.number().int().min(0).max(366).optional(),
        atRisk: z.boolean().optional(),
        q: filterText("Name, phone or licence number (case-insensitive contains)"),
      }),
      execute: (f) => safely("listDrivers", async () => {
        const now = Date.now();
        const soon = new Date(now + EXPIRY_SOON_DAYS * DAY);
        const cutoff = f.expiringWithinDays != null ? new Date(now + f.expiringWithinDays * DAY) : null;
        const where: Prisma.DriverWhereInput = {
          AND: [
            f.status ? { status: f.status } : { status: { not: "INACTIVE" } },
            f.type ? { type: f.type } : {},
            f.hold === true ? { hold: true } : f.hold === false ? { hold: false } : {},
            f.hasTruck === true ? { truck: { isNot: null } } : f.hasTruck === false ? { truck: { is: null } } : {},
            cutoff ? { OR: [{ licenseExpiry: { lte: cutoff } }, { medicalExpiry: { lte: cutoff } }] } : {},
            // Same rule as riskReasons(): "expiring within 30 days" includes already expired.
            f.atRisk ? { OR: [{ score: { lt: 75 } }, { licenseExpiry: { lte: soon } }, { medicalExpiry: { lte: soon } }] } : {},
            f.q ? { OR: [{ name: like(f.q) }, { phone: like(f.q) }, { phone2: like(f.q) }, { licenseNumber: like(f.q) }] } : {},
          ],
        };
        const select = {
          id: true, name: true, phone: true, email: true, status: true, type: true, hold: true, holdReason: true, score: true,
          licenseClass: true, licenseExpiry: true, medicalExpiry: true, hireDate: true,
          truck: { select: { id: true, unitNumber: true } },
          documents: { where: { kind: { in: [...REQUIRED_DRIVER_DOCS] } }, select: { kind: true } },
        } satisfies Prisma.DriverSelect;
        // Expiring: soonest of licence and medical first, which needs both dates, so the matches are sorted in memory.
        const [total, found] = await Promise.all([
          db.driver.count({ where }),
          db.driver.findMany({ where, orderBy: { name: "asc" }, take: cutoff ? SCAN : LIMIT, select }),
        ]);
        const soonest = (d: (typeof found)[number]) => Math.min(d.licenseExpiry.getTime(), d.medicalExpiry?.getTime() ?? Infinity);
        const drivers = (cutoff ? [...found].sort((a, b) => soonest(a) - soonest(b)) : found).slice(0, LIMIT);
        return {
          filters: f, total, showing: drivers.length, truncated: total > drivers.length,
          drivers: drivers.map((x) => {
            const have = new Set(x.documents.map((d) => d.kind));
            return {
              name: x.name, href: link(`/drivers/${x.id}`), phone: x.phone, email: x.email, employment: humanize(x.status), type: labelOf(DRIVER_TYPE_LABELS, x.type),
              onHold: x.hold, holdReason: x.hold ? (x.holdReason ?? "no reason recorded") : null,
              truck: x.truck ? { unit: x.truck.unitNumber, href: link(`/fleet/${x.truck.id}`) } : null,
              licence: { class: x.licenseClass, expires: fmtDate(x.licenseExpiry), daysLeft: daysUntil(x.licenseExpiry, now) },
              medical: { expires: fmtDate(x.medicalExpiry), daysLeft: daysUntil(x.medicalExpiry, now) },
              missingFiles: REQUIRED_DRIVER_DOCS.filter((k) => !have.has(k)).map((k) => DOC_KIND_LABELS[k]),
              score: x.score, riskReasons: riskReasons(x, now), hired: fmtDate(x.hireDate),
            };
          }),
          href: link("/drivers"),
        };
      }),
    }),

    search: tool({
      description: "Free-text search across trucks (unit number, plate, VIN, make, model, group, location), trailers (unit number, plate, location), drivers (name, phone, licence number) and work orders (#number, title, vendor). Use when you do not know what kind of thing the user means. Up to 5 hits per kind.",
      inputSchema: z.object({ q: queryText("Search text") }),
      execute: ({ q }) => safely("search", async () => {
        const n = /^#?(\d{1,9})$/.exec(q);
        const [trucks, trailers, drivers, workOrders] = await Promise.all([
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
            where: { OR: [...(n ? [{ number: Number(n[1]) }] : []), { title: like(q) }, { vendor: like(q) }] },
            take: 5, orderBy: { number: "desc" }, select: WO_ROW,
          }),
        ]);
        const now = Date.now();
        const today = todayStart(now);
        return {
          query: q,
          trucks: trucks.map((x) => ({ unit: x.unitNumber, vehicle: `${x.make} ${x.model}`, plate: x.plate, status: truckStatusLabel(x.status), driver: x.driver?.name ?? null, location: x.locationName, href: link(`/fleet/${x.id}`) })),
          trailers: trailers.map((x) => ({ unit: x.unitNumber, type: labelOf(EQUIPMENT_LABELS, x.type), status: labelOf(TRAILER_STATUS_LABELS, x.status), pairedTruck: x.truck?.unitNumber ?? null, location: x.locationName, href: link(`/fleet/trailers/${x.id}`) })),
          drivers: drivers.map((x) => ({ name: x.name, phone: x.phone, employment: humanize(x.status), onHold: x.hold, truck: x.truck?.unitNumber ?? null, href: link(`/drivers/${x.id}`) })),
          workOrders: workOrders.map((w) => woView(w, link, now, today)),
        };
      }),
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
