import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { getCurrentUser } from "./auth";
import { getFormat } from "./format-server";
import { can } from "./permissions";
import { dateOnly } from "./locale";
import { DOC_KIND_LABELS } from "./documents";
import { OIL_DUE_SOON, defectLabel, roLabel, serviceStatus } from "./service";
import { PTI_COMPONENT_LABELS, REPAIR_STAGE_LABELS, humanize } from "./constants";
import { categorize, countMarks } from "./pti-shared";
import { NO_SIGNAL_MS, isTrackerSource, sourceLabel } from "@/components/map/fleet-status";
import {
  DECISION_CATEGORIES, DECISION_CATEGORY_HINTS, DECISION_CATEGORY_LABELS, isDecisionCategory, sortDecisions,
  type Decision, type DecisionCategory, type DecisionPriority,
} from "@/app/(app)/dashboard/decision-types";

/*
 * What needs a decision today, from one set of rules shared by the Today page (/dashboard), its tiles, the alert bell
 * and /dashboard/alerts — so they always agree. Everything is computed once per request (React cache).
 *
 *  Oil       overdue by odometer (booked or not) · due within OIL_DUE_NOW · reading too old to tell when close
 *  Shop      repair past its promised date · waiting for approval · no update for STALE_UPDATE_DAYS · booked for an
 *            earlier day and never started · unit in the shop with no repair order
 *  Documents registration, annual inspection, insurance expired or missing · any dated paper expiring within
 *            PAPER_SOON_DAYS · company papers
 *  PTI       defect holding a truck out of service · repaired, waiting to be confirmed · "Now" defect · walk-around
 *            defect with no owner and no repair · past its fix-by date · walk-around video not sent / not reviewed
 *  Drivers   licence and medical · on hold · repair charged to a driver who has not been told · roadside
 *            correction overdue or out-of-service order open
 *  Fleet     active truck without a driver · lease mileage cap · trackers gone quiet
 */

/* ------------------------------------------------------------------ */
/* Kinds (the bell and /dashboard/alerts group by these)               */
/* ------------------------------------------------------------------ */

export const ALERT_KINDS = DECISION_CATEGORIES;
export type AlertKind = DecisionCategory;
export const ALERT_KIND_LABELS = DECISION_CATEGORY_LABELS;
export const ALERT_KIND_HINTS = DECISION_CATEGORY_HINTS;
export const isAlertKind = isDecisionCategory;

export type Alert = {
  level: "critical" | "warning";
  /** Grouping key (the Today categories). */
  kind: AlertKind;
  title: string;
  detail: string;
  /** Where the item is acted on (the action for editors, the record for view-only members). */
  href: string;
};

export type { Decision };

const DAY = 86_400_000;
/** Paperwork shows under "Coming up" this many days before it expires. */
export const EXPIRY_WINDOW_DAYS = 30;
/** Paperwork this close to expiring is a decision today. */
export const PAPER_SOON_DAYS = 7;
/** A repair in the shop with no stage change or note for this long gets chased. */
export const STALE_UPDATE_DAYS = 3;
/** Missing walk-around videos are chased once this few days of the week are left. */
const WALK_CHASE_DAYS_LEFT = 2;
/** More silent trackers than this become one summary row instead of one each. */
const SILENT_TRACKERS_ONE_BY_ONE = 3;
/** Window for "DOT inspections within 30 days". */
const DOT_WINDOW_DAYS = 30;

const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));
const daysUntil = (d: Date, now: Date) => Math.ceil((d.getTime() - now.getTime()) / DAY);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

function earliest(...dates: (Date | null | undefined)[]): Date | null {
  let min: Date | null = null;
  for (const d of dates) if (d && (!min || d < min)) min = d;
  return min;
}

/* ------------------------------------------------------------------ */
/* Loading (one round trip per request)                                */
/* ------------------------------------------------------------------ */

const truckSelect = {
  id: true, unitNumber: true, status: true, createdAt: true,
  odometerKm: true, odometerAt: true, pmIntervalKm: true, lastPmKm: true, lastPmAt: true, nextServiceKm: true,
  truckType: { select: { name: true, oilIntervalKm: true } },
  registrationExpiry: true, insuranceExpiry: true, inspectionExpiry: true,
  ownership: true, leaseStartKm: true, leaseAnnualLimitKm: true, leaseBufferPct: true, leaseOverageRate: true,
  lastPingAt: true, pingSource: true,
  driver: { select: { id: true, name: true, dispatcher: true } },
} satisfies Prisma.TruckSelect;

const trailerSelect = {
  id: true, unitNumber: true, status: true, statusSince: true, createdAt: true, insuranceExpiry: true, inspectionExpiry: true,
  truck: { select: { id: true, unitNumber: true, driver: { select: { id: true, name: true } } } },
} satisfies Prisma.TrailerSelect;

const workSelect = {
  id: true, number: true, title: true, status: true, stage: true, stageAt: true, promisedAt: true, inAt: true, scheduledAt: true,
  createdAt: true, updatedAt: true, repairType: true, category: true, priority: true, vendor: true,
  vendorRef: { select: { name: true } }, truckId: true, trailerId: true,
  truck: { select: { id: true, unitNumber: true, driver: { select: { id: true, name: true } } } },
  trailer: { select: { id: true, unitNumber: true } },
  /** The latest stage change or note: "last update". */
  events: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
} satisfies Prisma.WorkOrderSelect;

const loadToday = cache(async () => {
  const now = new Date();
  const f = await getFormat();
  const week = f.weekStart(now);
  const [trucks, trailers, drivers, docs, defects, walks, openWork, charges, roadside] = await Promise.all([
    db.truck.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" }, select: truckSelect }),
    db.trailer.findMany({ orderBy: { unitNumber: "asc" }, select: trailerSelect }),
    db.driver.findMany({
      where: { status: "ACTIVE" }, orderBy: { name: "asc" },
      select: { id: true, name: true, licenseExpiry: true, medicalExpiry: true, hold: true, holdReason: true, createdAt: true, truck: { select: { id: true, unitNumber: true } } },
    }),
    // Newest first: only the newest document of each kind counts per owner.
    db.document.findMany({
      where: { workOrderId: null, roadsideId: null, kind: { not: "PHOTO" } },
      orderBy: { createdAt: "desc" },
      select: { kind: true, name: true, expiresAt: true, truckId: true, trailerId: true, driverId: true, isCompany: true },
    }),
    db.defect.findMany({
      where: { status: { in: ["OPEN", "REPAIRED"] } },
      orderBy: { foundAt: "asc" },
      select: {
        id: true, number: true, truckId: true, trailerId: true, walkAroundId: true, component: true, description: true, severity: true,
        status: true, holdsUnit: true, foundAt: true, dueAt: true, ownerId: true, repairedAt: true,
        owner: { select: { name: true } }, workOrder: { select: { id: true, number: true, status: true } },
      },
    }),
    db.walkAround.findMany({ where: { weekStart: dateOnly(week.key) }, select: { truckId: true, video: true, receivedAt: true, reviewedAt: true, ratings: { select: { rating: true } } } }),
    db.workOrder.findMany({
      where: { status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] }, voidedAt: null },
      orderBy: [{ promisedAt: { sort: "asc", nulls: "last" } }, { scheduledAt: "asc" }],
      select: workSelect,
    }),
    // Charged to a driver who has not been told: nothing comes off their pay until they are.
    db.workOrder.findMany({
      where: { payer: "DRIVER", driverInformedAt: null, voidedAt: null, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, number: true, title: true, cost: true, invoiceTotal: true, createdAt: true,
        chargeDriver: { select: { id: true, name: true } },
        truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } },
      },
    }),
    db.roadsideInspection.findMany({
      where: { status: "OPEN", OR: [{ correctionDueAt: { not: null } }, { result: "OOS" }] },
      orderBy: { inspectedAt: "asc" },
      select: {
        id: true, reportNumber: true, inspectedAt: true, result: true, correctionDueAt: true, state: true,
        driver: { select: { id: true, name: true } },
        truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } },
        violations: { where: { correctedAt: null }, select: { oos: true } },
      },
    }),
  ]);
  return { now, f, week, trucks, trailers, drivers, docs, defects, walks, openWork, charges, roadside };
});

type Loaded = Awaited<ReturnType<typeof loadToday>>;
type Doc = Loaded["docs"][number];
type Truck = Loaded["trucks"][number];
type Trailer = Loaded["trailers"][number];
export type OpenRepair = Loaded["openWork"][number];

/* ------------------------------------------------------------------ */
/* Paperwork                                                           */
/* ------------------------------------------------------------------ */

export type PaperworkOwner = "truck" | "trailer" | "driver" | "company";
export type PaperworkItem = {
  owner: PaperworkOwner;
  /** Truck / trailer / driver id; null for company documents. */
  ownerId: string | null;
  /** Unit number, driver name or "Company". */
  who: string;
  /** "Insurance", "Driving licence", or the document's name. */
  what: string;
  expiresAt: Date;
  expired: boolean;
  href: string;
};

const PAPER_LABEL: Record<string, string> = {
  REGISTRATION: "Registration", INSURANCE: "Insurance", INSPECTION: "Annual inspection",
  LICENSE: "Driving licence", MEDICAL: "Medical certificate",
};
const paperLabel = (kind: string, name?: string) => (kind === "OTHER" && name ? name : PAPER_LABEL[kind] ?? DOC_KIND_LABELS[kind] ?? humanize(kind));

/** Papers a unit must carry. A trailer has no registration date on its record, so its registration counts only once uploaded. */
const REQUIRED: Record<"truck" | "trailer", readonly string[]> = { truck: ["REGISTRATION", "INSPECTION", "INSURANCE"], trailer: ["INSPECTION", "INSURANCE"] };
/** Kinds with a date on the unit or driver record, next to the uploaded document. */
const RECORD_KINDS: Record<"truck" | "trailer" | "driver", readonly string[]> = {
  truck: ["REGISTRATION", "INSPECTION", "INSURANCE"], trailer: ["REGISTRATION", "INSPECTION", "INSURANCE"], driver: ["LICENSE", "MEDICAL"],
};

type Paper = { kind: string; label: string; expiresAt: Date | null; onFile: boolean; required: boolean; record: boolean };

/** Newest document per owner and kind (documents of kind "Other" count per name). */
const docIndex = cache(async () => {
  const { docs } = await loadToday();
  const newest = new Map<string, Doc>();
  const byOwner = new Map<string, Doc[]>();
  for (const d of docs) {
    const owner = d.truckId ? `truck:${d.truckId}` : d.trailerId ? `trailer:${d.trailerId}` : d.driverId ? `driver:${d.driverId}` : d.isCompany ? "company:" : null;
    if (!owner) continue;
    const key = `${owner}:${d.kind === "OTHER" ? `OTHER:${d.name.trim().toLowerCase()}` : d.kind}`;
    if (newest.has(key)) continue;
    newest.set(key, d);
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), d]);
  }
  return { newest, byOwner };
});

/**
 * Every paper of an owner: the record kinds (expiry = the earlier of the record's date and the newest document's, so a
 * stale record date can't hide an expired certificate), then every other newest document that carries an expiry.
 */
function papersOf(
  index: Awaited<ReturnType<typeof docIndex>>,
  owner: "truck" | "trailer" | "driver",
  id: string,
  fields: Partial<Record<string, Date | null>>,
): Paper[] {
  const ownerKey = `${owner}:${id}`;
  const required = owner === "driver" ? [] : REQUIRED[owner];
  const out: Paper[] = RECORD_KINDS[owner].map((kind) => {
    const doc = index.newest.get(`${ownerKey}:${kind}`);
    const field = fields[kind] ?? null;
    return { kind, label: paperLabel(kind), expiresAt: earliest(field, doc?.expiresAt), onFile: Boolean(doc) || field != null, required: required.includes(kind), record: true };
  });
  for (const d of index.byOwner.get(ownerKey) ?? []) {
    if (RECORD_KINDS[owner].includes(d.kind) || !d.expiresAt) continue;
    out.push({ kind: d.kind, label: paperLabel(d.kind, d.name), expiresAt: d.expiresAt, onFile: true, required: false, record: false });
  }
  return out;
}

const truckFields = (t: Truck) => ({ REGISTRATION: t.registrationExpiry, INSPECTION: t.inspectionExpiry, INSURANCE: t.insuranceExpiry });
const trailerFields = (t: Trailer) => ({ INSPECTION: t.inspectionExpiry, INSURANCE: t.insuranceExpiry });

/**
 * Every paper that has expired or expires within EXPIRY_WINDOW_DAYS, soonest first: trucks, trailers, drivers and the
 * company. Inactive trucks and drivers are left out. Cached per request (the Today page's "Coming up" uses it).
 */
export const getPaperwork = cache(async (): Promise<PaperworkItem[]> => {
  const [{ now, trucks, trailers, drivers }, index] = await Promise.all([loadToday(), docIndex()]);
  const soon = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY);
  const items: PaperworkItem[] = [];
  const add = (owner: PaperworkOwner, ownerId: string | null, who: string, papers: Paper[], href: string) => {
    for (const p of papers) if (p.expiresAt && p.expiresAt <= soon) items.push({ owner, ownerId, who, what: p.label, expiresAt: p.expiresAt, expired: p.expiresAt < now, href });
  };
  for (const t of trucks) add("truck", t.id, t.unitNumber, papersOf(index, "truck", t.id, truckFields(t)), `/fleet/${t.id}?tab=documents`);
  for (const t of trailers) add("trailer", t.id, t.unitNumber, papersOf(index, "trailer", t.id, trailerFields(t)), `/fleet/trailers/${t.id}?tab=documents`);
  for (const d of drivers) add("driver", d.id, d.name, papersOf(index, "driver", d.id, { LICENSE: d.licenseExpiry, MEDICAL: d.medicalExpiry }), `/drivers/${d.id}`);
  for (const d of index.byOwner.get("company:") ?? []) {
    if (!d.expiresAt || d.expiresAt > soon) continue;
    items.push({ owner: "company", ownerId: null, who: "Company", what: companyPaperLabel(d), expiresAt: d.expiresAt, expired: d.expiresAt < now, href: "/admin/company" });
  }
  return items.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
});

/** "Company: Insurance", not "Company: Company insurance". */
function companyPaperLabel(d: Doc) {
  const short = paperLabel(d.kind, d.name).replace(/^company\s+/i, "");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

export type TodayTiles = {
  oilOverdue: number; oilOverdueBooked: number;
  oilDueNow: number; oilDueSoon: number;
  /** Open walk-around defects with no owner and no repair. */
  ptiUnassigned: number;
  /** Trucks held out of service by a defect. */
  trucksHeld: number;
  /** Trucks on the board this week, and the pre-trip board's Nothing sent / To review counters (same rules: categorize in pti.ts). */
  walkExpected: number; walkMissing: number; walkToReview: number;
  /** Last day of this walk-around week (company time). */
  walkDue: Date;
  waitingParts: number; waitingPartsSince: Date | null;
  /** Units with a required paper expired or missing. */
  docsHolding: number; docsExpired: number; docsMissing: number;
  inShop: number; inShopLate: number;
  dotSoon: number; dotExpired: number;
};

export type Today = {
  at: Date;
  week: { at: Date; key: string };
  decisions: Decision[];
  tiles: TodayTiles;
  /** Repairs in progress, earliest promised date first. */
  inShop: OpenRepair[];
  /** Trucks inside OIL_DUE_SOON of their oil service (not yet due now), closest first, with any booking. */
  oilSoon: { id: string; unitNumber: string; left: number; dueAtKm: number | null; booked: { id: string; number: number; scheduledAt: Date } | null }[];
  counts: { trucks: number; trailers: number };
};

const truckUnit = (t: { id: string; unitNumber: string }) => ({ kind: "truck" as const, label: t.unitNumber, href: `/fleet/${t.id}` });
const trailerUnit = (t: { id: string; unitNumber: string }) => ({ kind: "trailer" as const, label: t.unitNumber, href: `/fleet/trailers/${t.id}` });
const driverLink = (d: { id: string; name: string } | null | undefined) => (d ? { name: d.name, href: `/drivers/${d.id}` } : null);
const repairHref = (id: string) => `/maintenance/work-orders/${id}`;
/** Shop name: the vendor record, else the free-text vendor of older repairs. */
export const vendorOf = (w: Pick<OpenRepair, "vendorRef" | "vendor">) => w.vendorRef?.name ?? w.vendor ?? null;
/** When anything last happened on a repair: a stage change, a note, an edit, or it went in. */
export function lastUpdateOf(w: Pick<OpenRepair, "stageAt" | "inAt" | "createdAt" | "updatedAt" | "events">) {
  return new Date(Math.max(...[w.stageAt, w.inAt, w.createdAt, w.updatedAt, w.events[0]?.createdAt].filter((d): d is Date => Boolean(d)).map((d) => d.getTime())));
}

/**
 * The Today page in one computation: decision rows (sorted by priority, then age), the eight tile figures and the shop.
 * Role-aware only where it must be: money stays out of the rows for roles without money.view.
 */
export const getToday = cache(async (): Promise<Today> => {
  const [data, index, user] = await Promise.all([loadToday(), docIndex(), getCurrentUser()]);
  const { now, f, week, trucks, trailers, drivers, defects, walks, openWork, charges, roadside } = data;
  const seesMoney = can(user?.role, "money.view");
  const startOfToday = f.startOfDay(now);
  const soonCut = new Date(now.getTime() + PAPER_SOON_DAYS * DAY);
  const rows: Decision[] = [];
  const push = (d: Omit<Decision, "since"> & { since?: Date | null }) => rows.push({ ...d, since: (d.since ?? now).getTime() });

  const truckById = new Map(trucks.map((t) => [t.id, t]));
  const trailerById = new Map(trailers.map((t) => [t.id, t]));

  // Open work by unit.
  const inProgress = openWork.filter((w) => w.status === "IN_PROGRESS");
  const truckInShop = new Set(inProgress.map((w) => w.truckId).filter(Boolean));
  const openByTruck = new Map<string, OpenRepair[]>();
  const openByTrailer = new Map<string, OpenRepair[]>();
  for (const w of openWork) {
    if (w.truckId) openByTruck.set(w.truckId, [...(openByTruck.get(w.truckId) ?? []), w]);
    if (w.trailerId) openByTrailer.set(w.trailerId, [...(openByTrailer.get(w.trailerId) ?? []), w]);
  }
  const heldTrucks = new Set(defects.filter((d) => d.holdsUnit && d.truckId).map((d) => d.truckId!));

  /* ---------------- Oil ---------------- */
  let oilOverdue = 0, oilOverdueBooked = 0, oilDueNow = 0, oilDueSoon = 0;
  const oilSoon: Today["oilSoon"] = [];
  for (const t of trucks) {
    const s = serviceStatus(t, now);
    const booked = (openByTruck.get(t.id) ?? []).find((w) => w.repairType === "OIL_CHANGE" || w.category === "PM");
    const unit = truckUnit(t);
    const driver = driverLink(t.driver);
    const view = { label: "Open truck", href: unit.href };
    const bookedText = booked ? (booked.status === "IN_PROGRESS" ? `${roLabel(booked.number)} in the shop` : `${roLabel(booked.number)} booked ${f.day(booked.scheduledAt)}`) : null;
    const reading = s.stale ? (s.readingAt ? `reading from ${f.day(s.readingAt)}` : "no reading date") : null;
    if (s.state === "overdue") {
      oilOverdue++;
      if (booked) oilOverdueBooked++;
      push({
        key: `oil:${t.id}`, category: "oil", priority: booked ? "high" : "urgent", unit, driver,
        issue: "Oil change overdue",
        detail: join(`${s.stale ? "at least " : ""}${f.dist(-(s.left ?? 0))} over`, `due at ${f.dist(s.dueAtKm)}`, reading, bookedText),
        action: booked ? { label: "Open booking", href: repairHref(booked.id) } : { label: "Book oil service", href: `/maintenance/oil?book=${t.id}` },
        view, age: null, since: t.lastPmAt,
      });
    } else if (s.state === "due_now") {
      oilDueNow++;
      if (!booked) {
        push({
          key: `oil:${t.id}`, category: "oil", priority: "high", unit, driver, issue: "Oil change due",
          detail: join(`${f.dist(s.left)} left`, `due at ${f.dist(s.dueAtKm)}`),
          action: { label: "Book oil service", href: `/maintenance/oil?book=${t.id}` }, view, age: null, since: t.lastPmAt,
        });
      }
    } else if (s.state === "due_soon") {
      oilDueSoon++;
      oilSoon.push({ id: t.id, unitNumber: t.unitNumber, left: s.left ?? 0, dueAtKm: s.dueAtKm, booked: booked ? { id: booked.id, number: booked.number, scheduledAt: booked.scheduledAt } : null });
    } else if (s.state === "no_reading" && s.left != null && s.left <= OIL_DUE_SOON && !booked) {
      // Close to the interval on an old reading: it may already be due.
      push({
        key: `oil:${t.id}`, category: "oil", priority: "normal", unit, driver, issue: "Odometer reading needed",
        detail: join(s.used != null ? `at least ${f.dist(s.used)} used` : null, `${f.dist(s.left)} left at the last reading`, reading),
        action: { label: "Get reading", href: `/maintenance/oil?reading=${t.id}` }, view, age: null, since: s.readingAt,
      });
    }
  }

  /* ---------------- Shop ---------------- */
  let inShopLate = 0;
  let waitingParts = 0;
  let waitingPartsSince: Date | null = null;
  for (const w of openWork) {
    const unit = w.truck ? truckUnit(w.truck) : w.trailer ? trailerUnit(w.trailer) : null;
    const driver = driverLink(w.truck?.driver);
    const ro = roLabel(w.number);
    const view = { label: `Open ${ro}`, href: repairHref(w.id) };
    const stage = w.stage ? REPAIR_STAGE_LABELS[w.stage] ?? humanize(w.stage) : null;
    if (w.status === "IN_PROGRESS") {
      if (w.stage === "WAITING_PARTS") {
        waitingParts++;
        const since = w.stageAt ?? w.inAt ?? w.createdAt;
        if (!waitingPartsSince || since < waitingPartsSince) waitingPartsSince = since;
      }
      const lastUpdate = lastUpdateOf(w);
      if (w.promisedAt && w.promisedAt < now) {
        inShopLate++;
        const late = daysBetween(w.promisedAt, now);
        push({
          key: `repair:${w.id}`, category: "shop", priority: "high", unit, driver, issue: "Past promised date",
          detail: join(`${ro} ${w.title}`, vendorOf(w), stage, `promised ${f.day(w.promisedAt)}`),
          action: { label: "Chase update", href: repairHref(w.id) }, view, age: late ? `${late} d late` : "due today", since: w.promisedAt,
        });
      } else if (w.stage === "WAITING_APPROVAL") {
        push({
          key: `repair:${w.id}`, category: "shop", priority: "high", unit, driver, issue: "Shop waiting for approval",
          detail: join(`${ro} ${w.title}`, vendorOf(w), w.stageAt ? `since ${f.day(w.stageAt)}` : null),
          action: { label: "Review estimate", href: repairHref(w.id) }, view, age: w.stageAt ? `${daysBetween(w.stageAt, now)} d` : null, since: w.stageAt ?? w.inAt,
        });
      } else if (now.getTime() - lastUpdate.getTime() > STALE_UPDATE_DAYS * DAY) {
        const quiet = daysBetween(lastUpdate, now);
        push({
          key: `repair:${w.id}`, category: "shop", priority: "normal", unit, driver, issue: `No update for ${quiet} days`,
          detail: join(`${ro} ${w.title}`, vendorOf(w), stage, w.promisedAt ? `promised ${f.day(w.promisedAt)}` : "no promised date"),
          action: { label: "Chase update", href: repairHref(w.id) }, view, age: `${quiet} d`, since: lastUpdate,
        });
      }
    } else if (w.scheduledAt < startOfToday) {
      const late = daysBetween(w.scheduledAt, now);
      push({
        key: `repair:${w.id}`, category: "shop", priority: w.priority === "URGENT" ? "urgent" : late >= 7 ? "high" : "normal", unit, driver,
        issue: w.status === "DRAFT" ? "Draft repair never sent" : "Booked, not started",
        detail: join(`${ro} ${w.title}`, vendorOf(w), `booked ${f.day(w.scheduledAt)}`),
        action: { label: "Open repair", href: repairHref(w.id) }, view, age: `${late} d late`, since: w.scheduledAt,
      });
    }
  }
  for (const t of trucks) {
    if ((t.status === "MAINTENANCE" || t.status === "VENDOR" || t.status === "OUT_OF_SERVICE") && !openByTruck.get(t.id)?.length && !heldTrucks.has(t.id)) {
      push({
        key: `noro:${t.id}`, category: "shop", priority: "normal", unit: truckUnit(t), driver: driverLink(t.driver),
        issue: t.status === "MAINTENANCE" ? "In the shop, no repair order" : t.status === "VENDOR" ? "At a vendor, no repair order" : "Out of service, no repair order",
        detail: "Open a repair so the work, the downtime and the cost are tracked",
        action: { label: "Create repair", href: `/maintenance/work-orders/new?truck=${t.id}` }, view: { label: "Open truck", href: `/fleet/${t.id}` }, age: null,
      });
    }
  }
  for (const t of trailers) {
    if (t.status === "SHOP" && !openByTrailer.get(t.id)?.length) {
      const days = daysBetween(t.statusSince, now);
      push({
        key: `noro:${t.id}`, category: "shop", priority: days > 21 ? "high" : "normal", unit: trailerUnit(t), driver: driverLink(t.truck?.driver),
        issue: "In the shop, no repair order", detail: join(`in the shop since ${f.day(t.statusSince)}`, "open a repair so it is tracked"),
        action: { label: "Create repair", href: `/maintenance/work-orders/new?trailer=${t.id}` }, view: { label: "Open trailer", href: `/fleet/trailers/${t.id}` },
        age: `${days} d`, since: t.statusSince,
      });
    }
  }

  /* ---------------- Documents ---------------- */
  let docsHolding = 0, docsExpired = 0, docsMissing = 0, dotSoon = 0, dotExpired = 0;
  const dotCut = new Date(now.getTime() + DOT_WINDOW_DAYS * DAY);
  const unitPapers = (kind: "truck" | "trailer", id: string, unit: NonNullable<Decision["unit"]>, driver: Decision["driver"], papers: Paper[], createdAt: Date) => {
    const inspection = papers.find((p) => p.kind === "INSPECTION")?.expiresAt;
    if (inspection && inspection < now) dotExpired++;
    else if (inspection && inspection <= dotCut) dotSoon++;

    const expiredReq = papers.filter((p) => p.required && p.expiresAt && p.expiresAt < now);
    const missing = papers.filter((p) => p.required && !p.onFile);
    const expiredOther = papers.filter((p) => !p.required && p.expiresAt && p.expiresAt < now);
    const soon = papers.filter((p) => p.expiresAt && p.expiresAt >= now && p.expiresAt <= soonCut);
    if (expiredReq.length || missing.length) {
      docsHolding++;
      if (expiredReq.length) docsExpired++;
      if (missing.length) docsMissing++;
    }
    if (!expiredReq.length && !missing.length && !expiredOther.length && !soon.length) return;
    const expired = [...expiredReq, ...expiredOther];
    const parts = [
      ...expired.map((p) => `${p.label} expired ${f.day(p.expiresAt)}`),
      ...missing.map((p) => `no ${p.label.toLowerCase()} on file`),
      ...soon.map((p) => `${p.label} expires ${f.day(p.expiresAt)}`),
    ];
    const issue = expiredReq.length ? (expiredReq.length === 1 ? `${expiredReq[0].label} expired` : "Papers expired")
      : missing.length ? (missing.length === 1 ? `No ${missing[0].label.toLowerCase()} on file` : "Papers missing")
        : expiredOther.length ? (expiredOther.length === 1 ? `${expiredOther[0].label} expired` : "Papers expired")
          : soon.length === 1 ? `${soon[0].label} expires ${f.day(soon[0].expiresAt)}` : "Papers expiring";
    const priority: DecisionPriority = expiredReq.length ? "urgent" : missing.length || expiredOther.length ? "high" : "normal";
    const first = earliest(...expired.map((p) => p.expiresAt), ...soon.map((p) => p.expiresAt));
    const href = `${unit.href}?tab=documents`;
    push({
      key: `docs:${kind}:${id}`, category: "documents", priority, unit, driver,
      issue, detail: parts.slice(0, 3).join(" · ") + (parts.length > 3 ? ` · ${parts.length - 3} more` : ""),
      action: { label: expired.length || soon.length ? "Renew paper" : "Attach paper", href },
      view: { label: "Open documents", href },
      age: expired.length && first ? `expired ${daysBetween(first, now)} d ago` : first ? `in ${Math.max(0, daysUntil(first, now))} d` : null,
      since: first ?? createdAt,
    });
  };
  for (const t of trucks) unitPapers("truck", t.id, truckUnit(t), driverLink(t.driver), papersOf(index, "truck", t.id, truckFields(t)), t.createdAt);
  for (const t of trailers) unitPapers("trailer", t.id, trailerUnit(t), driverLink(t.truck?.driver), papersOf(index, "trailer", t.id, trailerFields(t)), t.createdAt);
  for (const d of index.byOwner.get("company:") ?? []) {
    if (!d.expiresAt || d.expiresAt > soonCut) continue;
    const expired = d.expiresAt < now;
    push({
      key: `docs:company:${d.kind}:${d.name}`, category: "documents", priority: expired ? "high" : "normal",
      unit: { kind: "company", label: "Company", href: "/admin/company" }, driver: null,
      issue: `${companyPaperLabel(d)} ${expired ? "expired" : "expires"} ${f.day(d.expiresAt)}`, detail: d.name,
      action: { label: "Renew paper", href: "/admin/company" }, view: { label: "Open company", href: "/admin/company" },
      age: expired ? `expired ${daysBetween(d.expiresAt, now)} d ago` : `in ${Math.max(0, daysUntil(d.expiresAt, now))} d`, since: d.expiresAt,
    });
  }

  /* ---------------- PTI: defects ---------------- */
  let ptiUnassigned = 0;
  for (const d of defects) {
    const truck = d.truckId ? truckById.get(d.truckId) : undefined;
    const trailer = d.trailerId ? trailerById.get(d.trailerId) : undefined;
    if (!truck && !trailer) continue; // unit archived
    const unit = truck ? truckUnit(truck) : trailerUnit(trailer!);
    const driver = driverLink(truck ? truck.driver : trailer!.truck?.driver);
    const unassigned = !d.ownerId && !d.workOrder;
    if (d.status === "OPEN" && unassigned && d.walkAroundId) ptiUnassigned++;
    const defectHref = `/inspections/defects?defect=${d.id}`;
    const confirm = { label: "Confirm & clear", href: truck ? `/inspections?review=${truck.id}` : defectHref };
    const next = d.workOrder
      ? (d.workOrder.status === "DONE" ? confirm : { label: "Chase repair", href: repairHref(d.workOrder.id) })
      : !d.ownerId
        ? { label: "Assign owner", href: defectHref }
        : { label: "Create repair", href: `/maintenance/work-orders/new?${truck ? `truck=${truck.id}` : `trailer=${trailer!.id}`}&defect=${d.id}` };
    const what = `${defectLabel(d.number)} ${PTI_COMPONENT_LABELS[d.component] ?? humanize(d.component)} — ${d.description}`;
    const who = d.owner ? `owner ${d.owner.name}` : d.workOrder ? null : "no owner";
    const ro = d.workOrder ? `${roLabel(d.workOrder.number)}${d.workOrder.status === "DONE" ? " done" : ""}` : null;
    const open = daysBetween(d.foundAt, now);
    let row: { priority: DecisionPriority; issue: string; action: { label: string; href: string } } | null = null;
    if (d.status === "REPAIRED") row = { priority: d.holdsUnit ? "urgent" : "high", issue: d.holdsUnit ? "Out of service · repaired, to confirm" : "Repaired, to confirm", action: confirm };
    else if (d.holdsUnit) row = { priority: "urgent", issue: "Out of service · defect", action: next };
    else if (d.severity === "NOW") row = { priority: "urgent", issue: "Fix before next load", action: next };
    else if (unassigned) row = { priority: d.severity === "SOON" ? "high" : "normal", issue: d.walkAroundId ? "Walk-around issue, no owner" : "Defect, no owner", action: next };
    else if (d.workOrder?.status === "DONE") row = { priority: "normal", issue: "Repair done, to confirm", action: confirm };
    else if (d.dueAt && d.dueAt < now) row = { priority: "normal", issue: "Past its fix-by date", action: next };
    if (!row) continue;
    push({
      key: `defect:${d.id}`, category: "pti", ...row, unit, driver,
      detail: join(what, who, ro, d.status === "REPAIRED" && d.repairedAt ? `repaired ${f.day(d.repairedAt)}` : null),
      view: { label: `Open ${defectLabel(d.number)}`, href: defectHref }, age: open ? `open ${open} d` : "found today", since: d.foundAt,
    });
  }

  /* ---------------- PTI: walk-arounds ---------------- */
  const weekEnd = new Date(week.at.getTime() + 7 * DAY);
  const walkDue = new Date(weekEnd.getTime() - DAY / 2); // noon of the last day: safe across DST
  const daysLeft = Math.max(0, Math.ceil((weekEnd.getTime() - now.getTime()) / DAY));
  const walkByTruck = new Map(walks.map((w) => [w.truckId, w]));
  let walkExpected = 0, walkMissing = 0, walkToReview = 0;
  for (const t of trucks) {
    const w = walkByTruck.get(t.id);
    // Same as the pre-trip board: a truck on the road is expected (driver or not); any truck someone marked counts too.
    const expected = (t.status === "ACTIVE" && !truckInShop.has(t.id)) || (t.status === "OUT_OF_SERVICE" && heldTrucks.has(t.id));
    if (!expected && !w) continue;
    walkExpected++;
    const marks = countMarks(w?.ratings ?? []);
    const cats = categorize(w?.video, Boolean(w?.reviewedAt), marks, expected);
    const review = `/inspections?review=${t.id}`;
    const unit = truckUnit(t);
    const driver = driverLink(t.driver);
    if (cats.review) {
      walkToReview++;
      const waited = w?.receivedAt ? daysBetween(w.receivedAt, now) : 0;
      push({
        key: `walk:${t.id}`, category: "pti", priority: waited >= 2 ? "high" : "normal", unit, driver, issue: "Walk-around to review",
        detail: w?.reviewedAt ? `${marks.unseen} not seen on the video` : join(w?.receivedAt ? `video sent ${f.weekday(w.receivedAt)}` : "video sent", "nobody has looked yet"),
        action: { label: "Open review", href: review }, view: { label: "Open board", href: "/inspections" },
        age: waited ? `${waited} d` : "today", since: w?.receivedAt ?? week.at,
      });
    }
    if (!cats.nothingSent) continue;
    walkMissing++;
    if (w?.video === "MISSING" || w?.video === "RECEIVED" || daysLeft <= WALK_CHASE_DAYS_LEFT) {
      push({
        key: `walk:${t.id}`, category: "pti", priority: daysLeft <= 1 ? "high" : "normal", unit, driver,
        issue: w?.video === "RECEIVED" ? "Walk-around: nothing could be seen" : "Walk-around not sent",
        detail: join(`due ${f.weekday(walkDue)}`, t.driver?.dispatcher ? `dispatcher ${t.driver.dispatcher}` : null),
        action: { label: "Chase driver", href: review }, view: { label: "Open board", href: "/inspections" },
        age: daysLeft ? `${daysLeft} d left` : "due today", since: week.at,
      });
    }
  }

  /* ---------------- Drivers ---------------- */
  for (const d of drivers) {
    const papers = papersOf(index, "driver", d.id, { LICENSE: d.licenseExpiry, MEDICAL: d.medicalExpiry });
    const expiredKey = papers.filter((p) => p.record && p.expiresAt && p.expiresAt < now);
    const soonKey = papers.filter((p) => p.record && p.expiresAt && p.expiresAt >= now && p.expiresAt <= soonCut);
    const expiredOther = papers.filter((p) => !p.record && p.expiresAt && p.expiresAt < now);
    const unit = { kind: "driver" as const, label: d.name, href: `/drivers/${d.id}` };
    const truck = d.truck ? truckUnit(d.truck) : null;
    if (expiredKey.length || soonKey.length || expiredOther.length) {
      const list = [...expiredKey, ...expiredOther];
      const first = earliest(...list.map((p) => p.expiresAt), ...soonKey.map((p) => p.expiresAt));
      push({
        key: `driverdocs:${d.id}`, category: "drivers",
        priority: expiredKey.length ? "urgent" : soonKey.length ? "high" : "normal",
        unit: truck ?? unit, driver: { name: d.name, href: unit.href },
        issue: expiredKey.length ? `${expiredKey.length === 1 ? expiredKey[0].label : "Licence and medical"} expired`
          : soonKey.length ? `${soonKey[0].label} expires ${f.day(soonKey[0].expiresAt)}` : `${expiredOther[0].label} expired`,
        detail: [...list.map((p) => `${p.label} expired ${f.day(p.expiresAt)}`), ...soonKey.map((p) => `${p.label} expires ${f.day(p.expiresAt)}`)].join(" · "),
        action: { label: expiredKey.length || soonKey.length ? "Renew papers" : "Update papers", href: unit.href }, view: { label: "Open driver", href: unit.href },
        age: list.length && first ? `expired ${daysBetween(first, now)} d ago` : first ? `in ${Math.max(0, daysUntil(first, now))} d` : null,
        since: first,
      });
    }
    if (d.hold) {
      push({
        key: `hold:${d.id}`, category: "drivers", priority: "normal", unit: truck ?? unit, driver: { name: d.name, href: unit.href },
        issue: "Driver on hold", detail: d.holdReason?.trim() || "No reason recorded",
        action: { label: "Review hold", href: unit.href }, view: { label: "Open driver", href: unit.href }, age: null, since: d.createdAt,
      });
    }
  }
  for (const w of charges) {
    if (!w.chargeDriver) continue;
    const amount = w.invoiceTotal ?? w.cost;
    const ro = roLabel(w.number);
    push({
      key: `charge:${w.id}`, category: "drivers", priority: "high",
      unit: w.truck ? truckUnit(w.truck) : w.trailer ? trailerUnit(w.trailer) : null, driver: driverLink(w.chargeDriver),
      issue: "Driver charge not told", detail: join(`${ro} ${w.title}`, seesMoney && amount ? f.money(amount) : null, `${w.chargeDriver.name} has not been told`),
      action: { label: "Tell driver", href: repairHref(w.id) }, view: { label: `Open ${ro}`, href: repairHref(w.id) },
      age: `${daysBetween(w.createdAt, now)} d`, since: w.createdAt,
    });
  }
  for (const r of roadside) {
    const overdue = Boolean(r.correctionDueAt && r.correctionDueAt < now);
    const oos = r.result === "OOS";
    if (!overdue && !oos) continue;
    const openViolations = r.violations.length;
    const href = `/inspections/roadside/${r.id}`;
    push({
      key: `roadside:${r.id}`, category: "drivers", priority: overdue ? "urgent" : "high",
      unit: r.truck ? truckUnit(r.truck) : r.trailer ? trailerUnit(r.trailer) : null, driver: driverLink(r.driver),
      issue: overdue ? "DOT inspection correction overdue" : "DOT out-of-service order",
      detail: join(`${r.reportNumber ? `Report ${r.reportNumber}` : "Inspection"} ${f.day(r.inspectedAt)}${r.state ? ` (${r.state})` : ""}`,
        openViolations ? plural(openViolations, "violation") + " open" : null, r.correctionDueAt ? `correction due ${f.day(r.correctionDueAt)}` : null),
      action: { label: "Record correction", href }, view: { label: "Open inspection", href },
      age: overdue && r.correctionDueAt ? `${daysBetween(r.correctionDueAt, now)} d late` : null, since: r.correctionDueAt ?? r.inspectedAt,
    });
  }

  /* ---------------- Fleet ---------------- */
  for (const t of trucks) {
    if (t.status === "ACTIVE" && !t.driver && !truckInShop.has(t.id) && !heldTrucks.has(t.id)) {
      push({
        key: `nodriver:${t.id}`, category: "fleet", priority: "normal", unit: truckUnit(t), driver: null, issue: "No driver",
        detail: "Active, but nobody is assigned", action: { label: "Assign driver", href: `/fleet/${t.id}/edit` }, view: { label: "Open truck", href: `/fleet/${t.id}` },
        age: null, since: t.createdAt,
      });
    }
    if (t.ownership === "LEASED" && t.leaseAnnualLimitKm) {
      const cap = (t.leaseStartKm ?? 0) + t.leaseAnnualLimitKm * (1 + (t.leaseBufferPct ?? 0) / 100);
      const over = Math.round(t.odometerKm - cap);
      if (over > -5000) {
        const exposure = over > 0 && t.leaseOverageRate && seesMoney ? `about ${f.money(over * t.leaseOverageRate)} to pay` : null;
        push({
          key: `lease:${t.id}`, category: "fleet", priority: over > 0 ? "high" : "normal", unit: truckUnit(t), driver: driverLink(t.driver),
          issue: over > 0 ? "Over the lease mileage cap" : "Near the lease mileage cap",
          detail: join(over > 0 ? `${f.dist(over)} over the cap` : `${f.dist(-over)} left before the cap`, exposure),
          action: { label: "Review lease", href: "/maintenance?tab=lease" }, view: { label: "Open truck", href: `/fleet/${t.id}` }, age: null,
        });
      }
    }
  }
  // Trackers gone quiet. Only trucks that report by themselves: a manual position is never "late".
  const silent = trucks.filter((t) => t.status === "ACTIVE" && isTrackerSource(t.pingSource) && (!t.lastPingAt || now.getTime() - t.lastPingAt.getTime() >= NO_SIGNAL_MS));
  if (silent.length > SILENT_TRACKERS_ONE_BY_ONE) {
    const units = silent.map((t) => t.unitNumber);
    push({
      key: "trackers", category: "fleet", priority: "normal", unit: null, driver: null, issue: `${silent.length} trackers silent for 3+ days`,
      detail: units.slice(0, 4).join(", ") + (units.length > 4 ? ` and ${units.length - 4} more` : ""),
      action: { label: "Open live map", href: "/tracking?status=nosignal" }, view: { label: "Open live map", href: "/tracking?status=nosignal" }, age: null,
    });
  } else {
    for (const t of silent) {
      push({
        key: `tracker:${t.id}`, category: "fleet", priority: "normal", unit: truckUnit(t), driver: driverLink(t.driver),
        issue: t.lastPingAt ? `No position for ${daysBetween(t.lastPingAt, now)} days` : "Tracker has never reported",
        detail: `${sourceLabel(t.pingSource)}${t.lastPingAt ? ` silent since ${f.day(t.lastPingAt)}` : ""}`,
        action: { label: "Open live map", href: `/tracking?truck=${t.id}` }, view: { label: "Open live map", href: `/tracking?truck=${t.id}` },
        age: null, since: t.lastPingAt,
      });
    }
  }

  return {
    at: now,
    week,
    decisions: sortDecisions(rows),
    tiles: {
      oilOverdue, oilOverdueBooked, oilDueNow, oilDueSoon,
      ptiUnassigned, trucksHeld: heldTrucks.size,
      walkExpected, walkMissing, walkToReview, walkDue,
      waitingParts, waitingPartsSince,
      docsHolding, docsExpired, docsMissing,
      inShop: inProgress.length, inShopLate,
      dotSoon, dotExpired,
    },
    inShop: inProgress,
    oilSoon: oilSoon.sort((a, b) => a.left - b.left),
    counts: { trucks: trucks.length, trailers: trailers.length },
  };
});

/** The Today table's rows: what needs a decision, by priority then age. */
export const getDecisions = cache(async (): Promise<Decision[]> => (await getToday()).decisions);

/**
 * The alert bell: the same rows as the Today table, so the two always agree. "Now" rows are critical. The link is the
 * row's action for people who can edit, the record for view-only members. Cached per request.
 */
export const getAlerts = cache(async (): Promise<Alert[]> => {
  const [decisions, user] = await Promise.all([getDecisions(), getCurrentUser()]);
  const edits = can(user?.role, "fleet.edit");
  return decisions.map((d) => ({
    level: d.priority === "urgent" ? "critical" : "warning",
    kind: d.category,
    title: d.unit && d.unit.kind !== "company" ? `${d.unit.label}: ${d.issue}` : d.issue,
    detail: d.driver && d.unit?.kind !== "driver" ? join(d.detail, d.driver.name) : d.detail,
    href: edits ? d.action.href : d.view.href,
  }));
});
