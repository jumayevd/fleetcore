import "server-only";
import { cache } from "react";
import { db } from "./db";
import { DOC_KIND_LABELS, REQUIRED_UNIT_DOCS } from "./documents";
import { date, money, number } from "./format";
import { NO_SIGNAL_MS, isTrackerSource, pmState, sourceLabel } from "@/components/map/fleet-status";

/* ------------------------------------------------------------------ */
/* Kinds                                                               */
/* ------------------------------------------------------------------ */

/** Alert categories, in the order the overview lists them when they tie. */
export const ALERT_KINDS = ["compliance", "maintenance", "drivers", "fleet"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  compliance: "Compliance", maintenance: "Maintenance", drivers: "Drivers", fleet: "Fleet",
};
export const ALERT_KIND_HINTS: Record<AlertKind, string> = {
  compliance: "Truck, trailer and company paperwork: expiring, expired or missing",
  maintenance: "PM by odometer, overdue work orders, units in the shop",
  drivers: "Licences, medicals and driver documents, drivers on hold",
  fleet: "Trucks without a driver, lease mileage caps, silent trackers",
};
export const isAlertKind = (v: unknown): v is AlertKind => typeof v === "string" && (ALERT_KINDS as readonly string[]).includes(v);

export type Alert = {
  level: "critical" | "warning";
  /** Grouping key for the overview and /dashboard/alerts. */
  kind: AlertKind;
  title: string;
  detail: string;
  /** An existing page where the item is acted on. */
  href: string;
};

const DAY = 86_400_000;
/** Paperwork shows up this many days before it expires (same window as ExpiryBadge and the fleet pages). */
export const EXPIRY_WINDOW_DAYS = 30;
/** More silent trackers than this become one summary alert instead of one each. */
const SILENT_TRACKERS_ONE_BY_ONE = 3;

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

const RECORD_LABEL: Record<string, string> = {
  REGISTRATION: "Registration", INSURANCE: "Insurance", INSPECTION: "Technical inspection",
  LICENSE: "Driving licence", MEDICAL: "Medical certificate",
};

function earliest(...dates: (Date | null | undefined)[]): Date | null {
  let min: Date | null = null;
  for (const d of dates) if (d && (!min || d < min)) min = d;
  return min;
}

/**
 * Every paper that has expired or expires within EXPIRY_WINDOW_DAYS, soonest first: truck, trailer, driver and
 * company. Rules, so one paper never shows twice and a replaced certificate stops nagging:
 *  - only the newest uploaded document of each kind counts per owner (documents of kind "Other" count per name);
 *  - registration, insurance and inspection (units) and licence and medical (drivers) take the earlier of the date
 *    on the record and the newest document's expiry, like the fleet pages do;
 *  - inactive trucks and inactive drivers are left out.
 * Cached per request: alerts and the overview share it.
 */
export const getPaperwork = cache(async (): Promise<PaperworkItem[]> => {
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY);
  const [trucks, trailers, drivers, docs] = await Promise.all([
    db.truck.findMany({ where: { status: { not: "INACTIVE" } }, select: { id: true, unitNumber: true, insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true } }),
    db.trailer.findMany({ select: { id: true, unitNumber: true, insuranceExpiry: true, inspectionExpiry: true } }),
    db.driver.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, licenseExpiry: true, medicalExpiry: true } }),
    db.document.findMany({
      where: { workOrderId: null, kind: { not: "PHOTO" } },
      orderBy: { createdAt: "desc" },
      select: { kind: true, name: true, expiresAt: true, truckId: true, trailerId: true, driverId: true, isCompany: true },
    }),
  ]);

  // Newest document per owner and kind (rows arrive newest first).
  type Doc = (typeof docs)[number] & { owner: PaperworkOwner; ownerId: string | null };
  const newest = new Map<string, Doc>();
  for (const d of docs) {
    const [owner, ownerId]: [PaperworkOwner, string | null] | [null, null] = d.truckId ? ["truck", d.truckId] : d.trailerId ? ["trailer", d.trailerId]
      : d.driverId ? ["driver", d.driverId] : d.isCompany ? ["company", null] : [null, null];
    if (!owner) continue;
    const key = `${owner}:${ownerId ?? ""}:${d.kind === "OTHER" ? `OTHER:${d.name.trim().toLowerCase()}` : d.kind}`;
    if (!newest.has(key)) newest.set(key, { ...d, owner, ownerId });
  }

  const items: PaperworkItem[] = [];
  const add = (owner: PaperworkOwner, ownerId: string | null, who: string, what: string, expiresAt: Date | null, href: string) => {
    if (expiresAt && expiresAt <= soon) items.push({ owner, ownerId, who, what, expiresAt, expired: expiresAt < now, href });
  };
  /** The newest document of `kind` for an owner, marked as used so the generic pass below skips it. */
  const take = (owner: PaperworkOwner, ownerId: string, kind: string) => {
    const key = `${owner}:${ownerId}:${kind}`;
    const d = newest.get(key);
    newest.delete(key);
    return d?.expiresAt ?? null;
  };

  const truckById = new Map(trucks.map((t) => [t.id, t]));
  const trailerById = new Map(trailers.map((t) => [t.id, t]));
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  for (const t of trucks) {
    const href = `/fleet/${t.id}`;
    add("truck", t.id, t.unitNumber, RECORD_LABEL.REGISTRATION, earliest(t.registrationExpiry, take("truck", t.id, "REGISTRATION")), href);
    add("truck", t.id, t.unitNumber, RECORD_LABEL.INSURANCE, earliest(t.insuranceExpiry, take("truck", t.id, "INSURANCE")), href);
    add("truck", t.id, t.unitNumber, RECORD_LABEL.INSPECTION, earliest(t.inspectionExpiry, take("truck", t.id, "INSPECTION")), href);
  }
  for (const t of trailers) {
    const href = `/fleet/trailers/${t.id}`;
    add("trailer", t.id, t.unitNumber, RECORD_LABEL.INSURANCE, earliest(t.insuranceExpiry, take("trailer", t.id, "INSURANCE")), href);
    add("trailer", t.id, t.unitNumber, RECORD_LABEL.INSPECTION, earliest(t.inspectionExpiry, take("trailer", t.id, "INSPECTION")), href);
  }
  for (const d of drivers) {
    const href = `/drivers/${d.id}`;
    add("driver", d.id, d.name, RECORD_LABEL.LICENSE, earliest(d.licenseExpiry, take("driver", d.id, "LICENSE")), href);
    add("driver", d.id, d.name, RECORD_LABEL.MEDICAL, earliest(d.medicalExpiry, take("driver", d.id, "MEDICAL")), href);
  }
  // Everything else that carries an expiry date: permits, leases, contracts, passports, company papers…
  for (const d of newest.values()) {
    if (!d.expiresAt) continue;
    const what = d.kind === "OTHER" ? d.name : (DOC_KIND_LABELS[d.kind] ?? d.name);
    if (d.owner === "truck") { const t = truckById.get(d.ownerId!); if (t) add("truck", t.id, t.unitNumber, what, d.expiresAt, `/fleet/${t.id}`); }
    else if (d.owner === "trailer") { const t = trailerById.get(d.ownerId!); if (t) add("trailer", t.id, t.unitNumber, what, d.expiresAt, `/fleet/trailers/${t.id}`); }
    else if (d.owner === "driver") { const p = driverById.get(d.ownerId!); if (p) add("driver", p.id, p.name, what, d.expiresAt, `/drivers/${p.id}`); }
    else {
      // "Company: Insurance", not "Company: Company insurance".
      const short = what.replace(/^company\s+/i, "");
      add("company", null, "Company", short.charAt(0).toUpperCase() + short.slice(1), d.expiresAt, "/admin/company");
    }
  }
  return items.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
});

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));

/**
 * What needs a fleet specialist: paperwork, PM and the shop, drivers, and trucks that can't run. Critical first.
 * Cached per request, so the shell's alert bell and the overview share one computation.
 */
export const getAlerts = cache(async (): Promise<Alert[]> => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const [paperwork, trucks, trailers, unitDocs, trailersInShop, openWork, lateWork, held] = await Promise.all([
    getPaperwork(),
    db.truck.findMany({
      where: { status: { not: "INACTIVE" } },
      orderBy: { unitNumber: "asc" },
      select: {
        id: true, unitNumber: true, status: true, driverId: true, odometerKm: true, pmIntervalKm: true, lastPmKm: true, nextServiceKm: true,
        ownership: true, leaseStartKm: true, leaseAnnualLimitKm: true, leaseBufferPct: true, leaseOverageRate: true, lastPingAt: true, pingSource: true,
      },
    }),
    db.trailer.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true } }),
    db.document.findMany({
      where: { OR: [{ truckId: { not: null } }, { trailerId: { not: null } }], kind: { in: [...REQUIRED_UNIT_DOCS] } },
      select: { truckId: true, trailerId: true, kind: true },
    }),
    db.trailer.findMany({ where: { status: "SHOP", statusSince: { lt: new Date(now.getTime() - 7 * DAY) } }, select: { id: true, unitNumber: true, statusSince: true } }),
    db.workOrder.findMany({
      where: { status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] }, truckId: { not: null } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, number: true, truckId: true, category: true, status: true, scheduledAt: true },
    }),
    // Booked for an earlier day and still not started.
    db.workOrder.findMany({
      where: { status: { in: ["DRAFT", "OPEN"] }, scheduledAt: { lt: startOfToday } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, number: true, title: true, status: true, priority: true, scheduledAt: true, truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } },
    }),
    db.driver.findMany({ where: { status: "ACTIVE", hold: true }, orderBy: { name: "asc" }, select: { id: true, name: true, holdReason: true, truck: { select: { unitNumber: true } } } }),
  ]);

  const alerts: Alert[] = [];

  /* Paperwork: units, company, drivers */
  for (const p of paperwork) {
    alerts.push({
      level: p.expired ? "critical" : "warning",
      kind: p.owner === "driver" ? "drivers" : "compliance",
      title: `${p.who}: ${p.what}`,
      detail: `${p.expired ? "expired" : "expires"} ${date(p.expiresAt)}`,
      href: p.href,
    });
  }

  // Missing required unit paperwork: one alert per unit, not per document (triage, not noise). A unit with nothing on
  // file at all is a setup gap, shown on the maintenance compliance tab rather than as an alert.
  const have = new Map<string, Set<string>>();
  for (const d of unitDocs) {
    const key = d.truckId ? `t:${d.truckId}` : `r:${d.trailerId}`;
    if (!have.has(key)) have.set(key, new Set());
    have.get(key)!.add(d.kind);
  }
  const missingAlert = (key: string, unit: string, href: string) => {
    const missing = REQUIRED_UNIT_DOCS.filter((k) => !have.get(key)?.has(k));
    if (missing.length && missing.length < REQUIRED_UNIT_DOCS.length) {
      alerts.push({ level: "warning", kind: "compliance", title: `${unit}: paperwork incomplete`, detail: `no ${missing.map((m) => RECORD_LABEL[m].toLowerCase()).join(", ")} on file`, href });
    }
  };
  for (const t of trucks) missingAlert(`t:${t.id}`, t.unitNumber, `/fleet/${t.id}`);
  for (const t of trailers) missingAlert(`r:${t.id}`, t.unitNumber, `/fleet/trailers/${t.id}`);

  /* Drivers */
  for (const d of held) {
    alerts.push({
      level: "warning", kind: "drivers", title: `${d.name} on hold`,
      detail: [d.holdReason?.trim() || "no reason recorded", d.truck ? `assigned to ${d.truck.unitNumber}` : null].filter(Boolean).join(" · "),
      href: `/drivers/${d.id}`,
    });
  }

  /* Maintenance */
  const workByTruck = new Map<string, typeof openWork>();
  for (const w of openWork) workByTruck.set(w.truckId!, [...(workByTruck.get(w.truckId!) ?? []), w]);
  for (const t of trucks) {
    const work = workByTruck.get(t.id) ?? [];
    // PM by odometer. A PM already booked takes care of "due soon"; an overdue one stays, pointing at the booking.
    const pm = pmState(t);
    if (pm.state === "overdue" || pm.state === "due") {
      const booked = work.find((w) => w.category === "PM");
      if (pm.state === "overdue" || !booked) {
        const left = pm.leftKm!;
        alerts.push({
          level: pm.state === "overdue" ? "critical" : "warning", kind: "maintenance",
          title: `${t.unitNumber}: PM ${pm.state === "overdue" ? "overdue" : "due"}`,
          detail: (left < 0 ? `${number(-left)} km past service` : `in ${number(left)} km`)
            + (booked ? ` · #${booked.number} ${booked.status === "IN_PROGRESS" ? "in progress" : `booked ${date(booked.scheduledAt)}`}` : ""),
          href: booked ? `/maintenance/work-orders/${booked.id}` : `/fleet/${t.id}`,
        });
      }
    }
    // In the shop (or parked out of service) with nothing recorded about why.
    if ((t.status === "MAINTENANCE" || t.status === "OUT_OF_SERVICE") && work.length === 0) {
      alerts.push({
        level: "warning", kind: "maintenance",
        title: `${t.unitNumber}: ${t.status === "MAINTENANCE" ? "in shop" : "out of service"}, no work order`,
        detail: "open a work order so the repair is tracked", href: `/fleet/${t.id}`,
      });
    }
  }
  for (const w of lateWork) {
    const late = daysBetween(w.scheduledAt, now);
    const unit = w.truck?.unitNumber ?? w.trailer?.unitNumber;
    alerts.push({
      level: w.priority === "URGENT" || late >= 7 ? "critical" : "warning", kind: "maintenance",
      title: `${unit ? `${unit}: ` : ""}#${w.number} ${w.title}`,
      detail: `booked ${date(w.scheduledAt)}, ${w.status === "DRAFT" ? "still a draft" : "not started"}`,
      href: `/maintenance/work-orders/${w.id}`,
    });
  }
  for (const t of trailersInShop) {
    const days = daysBetween(t.statusSince, now);
    alerts.push({ level: days > 21 ? "critical" : "warning", kind: "maintenance", title: `${t.unitNumber} in shop ${days} d`, detail: "trailer unavailable", href: `/fleet/trailers/${t.id}` });
  }

  /* Fleet */
  const inProgress = new Set(openWork.filter((w) => w.status === "IN_PROGRESS").map((w) => w.truckId));
  for (const t of trucks) {
    if (t.status === "ACTIVE" && !t.driverId && !inProgress.has(t.id)) {
      alerts.push({ level: "warning", kind: "fleet", title: `${t.unitNumber}: no driver`, detail: "active, but nobody is assigned", href: `/fleet/${t.id}` });
    }
    if (t.ownership === "LEASED" && t.leaseAnnualLimitKm) {
      const cap = (t.leaseStartKm ?? 0) + t.leaseAnnualLimitKm * (1 + (t.leaseBufferPct ?? 0) / 100);
      const over = t.odometerKm - cap;
      if (over > -5000) {
        const exposure = over > 0 && t.leaseOverageRate ? ` · about ${money(over * t.leaseOverageRate)} to pay` : "";
        alerts.push({
          level: over > 0 ? "critical" : "warning", kind: "fleet", title: `${t.unitNumber}: lease mileage cap`,
          detail: over > 0 ? `${number(over)} km over the cap${exposure}` : `${number(-over)} km left before the cap`, href: `/fleet/${t.id}`,
        });
      }
    }
  }
  // Trackers gone quiet. Only trucks that report by themselves: a manual position is never "late".
  const silent = trucks.filter((t) => t.status === "ACTIVE" && isTrackerSource(t.pingSource) && (!t.lastPingAt || now.getTime() - t.lastPingAt.getTime() >= NO_SIGNAL_MS));
  if (silent.length > SILENT_TRACKERS_ONE_BY_ONE) {
    const units = silent.map((t) => t.unitNumber);
    alerts.push({
      level: "warning", kind: "fleet", title: `${silent.length} trackers silent for 3+ days`,
      detail: units.slice(0, 4).join(", ") + (units.length > 4 ? ` and ${units.length - 4} more` : ""), href: "/tracking?status=nosignal",
    });
  } else {
    for (const t of silent) {
      alerts.push({
        level: "warning", kind: "fleet",
        title: `${t.unitNumber}: no position${t.lastPingAt ? ` for ${daysBetween(t.lastPingAt, now)} d` : " yet"}`,
        detail: `${sourceLabel(t.pingSource)} ${t.lastPingAt ? `silent since ${date(t.lastPingAt)}` : "has never reported"}`,
        href: `/tracking?truck=${t.id}`,
      });
    }
  }

  // Stable: inside each level, items keep the order above (and paperwork stays soonest first).
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
});
