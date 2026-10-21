import "server-only";
import { cache } from "react";
import { db } from "./db";
import { estimatedArrival } from "./telemetry";
import { REQUIRED_UNIT_DOCS } from "./documents";
import { CLAIM_OPEN_STATUSES } from "./constants";

export type Alert = {
  level: "critical" | "warning";
  /** Grouping key for the dashboard / digest: compliance | dispatch | fleet | money | safety */
  kind: "compliance" | "dispatch" | "fleet" | "money" | "safety";
  title: string;
  detail: string;
  href: string;
};

const DAY = 86_400_000;

/**
 * Operational exceptions that need a human: compliance, late loads, overdue money, service due. Sorted critical first.
 * Cached per request, so the shell (alert bell) and the overview share one computation.
 */
export const getAlerts = cache(async (): Promise<Alert[]> => {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * DAY);
  const [drivers, trucks, transit, overdue, unassigned, dispatchedNoRc, trailersInShop, leased, openClaims, idleDrivers, unitDocs, docs] = await Promise.all([
    db.driver.findMany({ where: { status: "ACTIVE", OR: [{ licenseExpiry: { lte: soon } }, { medicalExpiry: { lte: soon } }] } }),
    db.truck.findMany({ where: { status: { not: "INACTIVE" } } }),
    db.load.findMany({ where: { status: "IN_TRANSIT" } }),
    db.invoice.findMany({ where: { status: "SENT", dueAt: { lt: now } }, include: { customer: true } }),
    db.load.findMany({ where: { status: "PLANNED", pickupAt: { lte: new Date(now.getTime() + DAY) } } }),
    db.load.findMany({ where: { status: { in: ["ASSIGNED", "IN_TRANSIT"] }, documents: { none: { kind: "RC" } } }, select: { id: true, reference: true, customer: { select: { name: true } } } }),
    db.trailer.findMany({ where: { status: "SHOP", statusSince: { lt: new Date(now.getTime() - 7 * DAY) } } }),
    db.truck.findMany({ where: { ownership: "LEASED", leaseAnnualLimitKm: { not: null } } }),
    db.claim.findMany({ where: { status: { in: [...CLAIM_OPEN_STATUSES] }, createdAt: { lt: new Date(now.getTime() - 14 * DAY) } } }),
    db.driver.findMany({ where: { status: "ACTIVE", boardStatus: "READY", boardStatusSince: { lt: new Date(now.getTime() - 2 * DAY) }, loads: { none: { status: { in: ["ASSIGNED", "IN_TRANSIT"] } } } } }),
    db.document.findMany({ where: { OR: [{ truckId: { not: null } }, { trailerId: { not: null } }], kind: { in: [...REQUIRED_UNIT_DOCS] } }, select: { truckId: true, trailerId: true, kind: true } }),
    db.document.findMany({
      where: { expiresAt: { lte: soon } },
      include: { truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } }, driver: { select: { name: true } }, customer: { select: { name: true } }, load: { select: { reference: true } } },
    }),
  ]);

  const alerts: Alert[] = [];
  const lvl = (d: Date) => (d < now ? "critical" : "warning") as Alert["level"];
  const when = (d: Date) => (d < now ? "expired" : `expires ${d.toLocaleDateString("en-GB")}`);

  // Compliance — people
  for (const d of drivers) {
    if (d.licenseExpiry <= soon) alerts.push({ level: lvl(d.licenseExpiry), kind: "compliance", title: `${d.name}: driving licence`, detail: when(d.licenseExpiry), href: `/drivers/${d.id}` });
    if (d.medicalExpiry && d.medicalExpiry <= soon) alerts.push({ level: lvl(d.medicalExpiry), kind: "compliance", title: `${d.name}: medical certificate`, detail: when(d.medicalExpiry), href: `/drivers/${d.id}` });
  }
  // Compliance — units
  for (const t of trucks) {
    if (t.insuranceExpiry && t.insuranceExpiry <= soon) alerts.push({ level: lvl(t.insuranceExpiry), kind: "compliance", title: `${t.unitNumber}: insurance`, detail: when(t.insuranceExpiry), href: `/fleet/${t.id}` });
    if (t.inspectionExpiry && t.inspectionExpiry <= soon) alerts.push({ level: lvl(t.inspectionExpiry), kind: "compliance", title: `${t.unitNumber}: technical inspection`, detail: when(t.inspectionExpiry), href: `/fleet/${t.id}` });
    if (t.registrationExpiry && t.registrationExpiry <= soon) alerts.push({ level: lvl(t.registrationExpiry), kind: "compliance", title: `${t.unitNumber}: registration`, detail: when(t.registrationExpiry), href: `/fleet/${t.id}` });
    // Service by odometer: explicit next service, else PM interval since last PM
    const nextService = t.nextServiceKm ?? (t.lastPmKm != null ? t.lastPmKm + t.pmIntervalKm : null);
    if (nextService != null) {
      const left = nextService - t.odometerKm;
      if (left < 2000) alerts.push({ level: left < 0 ? "critical" : "warning", kind: "fleet", title: `${t.unitNumber}: service due`, detail: left < 0 ? `${(-left).toLocaleString()} km overdue` : `in ${left.toLocaleString()} km`, href: `/fleet/${t.id}` });
    }
  }
  for (const t of leased) {
    const allowed = (t.leaseStartKm ?? 0) + (t.leaseAnnualLimitKm ?? 0) * (1 + (t.leaseBufferPct ?? 0) / 100);
    const over = t.odometerKm - allowed;
    if (over > -5000) {
      const exposure = over > 0 && t.leaseOverageRate ? ` · ~$${Math.round(over * t.leaseOverageRate).toLocaleString()} penalty` : "";
      alerts.push({ level: over > 0 ? "critical" : "warning", kind: "money", title: `${t.unitNumber}: lease mileage cap`, detail: over > 0 ? `${Math.round(over).toLocaleString()} km over cap${exposure}` : `${Math.round(-over).toLocaleString()} km left`, href: `/fleet/${t.id}` });
    }
  }
  for (const d of docs) {
    const who = d.truck?.unitNumber ?? d.trailer?.unitNumber ?? d.driver?.name ?? d.customer?.name ?? d.load?.reference ?? "Company";
    const href = d.truckId ? `/fleet/${d.truckId}` : d.trailerId ? `/fleet/trailers/${d.trailerId}` : d.driverId ? `/drivers/${d.driverId}` : d.customerId ? `/customers/${d.customerId}` : d.loadId ? `/loads/${d.loadId}` : "/admin/company";
    alerts.push({ level: lvl(d.expiresAt!), kind: "compliance", title: `${who}: ${d.name}`, detail: `document ${when(d.expiresAt!)}`, href });
  }
  // Missing required unit paperwork (one alert per unit, not per document — triage, not noise)
  const have = new Map<string, Set<string>>();
  for (const d of unitDocs) {
    const key = d.truckId ? `t:${d.truckId}` : `r:${d.trailerId}`;
    if (!have.has(key)) have.set(key, new Set());
    have.get(key)!.add(d.kind);
  }
  for (const t of trucks) {
    const missing = REQUIRED_UNIT_DOCS.filter((k) => !have.get(`t:${t.id}`)?.has(k));
    if (missing.length === REQUIRED_UNIT_DOCS.length) continue; // never uploaded anything: shown on the fleet compliance tab, not as an alert
    if (missing.length) alerts.push({ level: "warning", kind: "compliance", title: `${t.unitNumber}: paperwork incomplete`, detail: `missing ${missing.map((m) => m.toLowerCase()).join(", ")}`, href: `/fleet/${t.id}` });
  }

  // Dispatch
  for (const l of transit) {
    // Still on the road after the delivery time counts as late even when the estimate has already passed.
    const eta = estimatedArrival(l);
    const arrival = Math.max(eta?.getTime() ?? 0, now.getTime());
    if (arrival > l.deliveryAt.getTime()) {
      const hrs = Math.max(1, Math.round((arrival - l.deliveryAt.getTime()) / 3_600_000));
      const detail = eta && eta.getTime() >= now.getTime() ? `ETA ~${hrs}h after delivery window` : `${hrs}h past the delivery window, not delivered yet`;
      alerts.push({ level: hrs > 6 ? "critical" : "warning", kind: "dispatch", title: `${l.reference} running late`, detail, href: `/loads/${l.id}` });
    }
  }
  for (const l of unassigned) alerts.push({ level: "warning", kind: "dispatch", title: `${l.reference} not assigned`, detail: `pickup ${l.pickupAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`, href: `/loads/${l.id}` });
  for (const l of dispatchedNoRc) alerts.push({ level: "warning", kind: "money", title: `${l.reference}: no rate confirmation`, detail: `${l.customer.name} · upload the RC before delivery`, href: `/loads/${l.id}` });
  for (const d of idleDrivers) {
    const days = Math.floor((now.getTime() - d.boardStatusSince.getTime()) / DAY);
    alerts.push({ level: "warning", kind: "dispatch", title: `${d.name} idle ${days}d`, detail: "ready, no load assigned", href: `/dispatch?driver=${d.id}` });
  }

  // Fleet
  for (const t of trailersInShop) {
    const days = Math.floor((now.getTime() - t.statusSince.getTime()) / DAY);
    alerts.push({ level: days > 21 ? "critical" : "warning", kind: "fleet", title: `${t.unitNumber} in shop ${days}d`, detail: "trailer unavailable", href: `/fleet/trailers?status=SHOP` });
  }

  // Money
  for (const i of overdue) {
    const days = Math.floor((now.getTime() - i.dueAt.getTime()) / DAY);
    alerts.push({ level: days > 15 ? "critical" : "warning", kind: "money", title: `${i.number} overdue`, detail: `${i.customer.name} · ${days}d late`, href: `/finance/invoices/${i.id}` });
  }

  // Safety
  for (const c of openClaims) {
    const days = Math.floor((now.getTime() - c.createdAt.getTime()) / DAY);
    alerts.push({ level: c.severity === "CRITICAL" || days > 45 ? "critical" : "warning", kind: "safety", title: `${c.number} open ${days}d`, detail: `${c.type.toLowerCase().replace(/_/g, " ")} · ${c.status.toLowerCase().replace(/_/g, " ")}`, href: `/claims/${c.id}` });
  }

  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
});
