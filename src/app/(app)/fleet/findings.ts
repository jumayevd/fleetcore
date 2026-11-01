import type { ServiceState } from "@/lib/service";
import { NO_SIGNAL_MS } from "@/components/map/fleet-status";

/*
 * What needs a look on the trucks list ("Needs attention"): one finding per kind of problem, each a card with how many
 * trucks have it, and the list of those trucks behind it. Red and amber findings count towards Needs attention; blue
 * ones are worth knowing (no driver, papers due in two or three months) but nothing to do yet. Inactive trucks have none.
 */

export type FindingTone = "danger" | "warn" | "info";
type Def = { key: string; tone: FindingTone; title: (n: number) => string; hint: string; short: string };

const DAY = 86_400_000;
/** "1 truck is" / "3 trucks are" (or has / have). */
const are = (n: number) => `${n} truck${n === 1 ? " is" : "s are"}`;
const has = (n: number) => `${n} truck${n === 1 ? " has" : "s have"}`;

/** Worst first: the order of the cards. `short` is what the unit cell says beside the unit number. */
export const FINDINGS = [
  { key: "oos", tone: "danger", title: (n) => `${are(n)} out of service`, hint: "Held by a defect until someone confirms the repair.", short: "out of service" },
  { key: "defect_now", tone: "danger", title: (n) => `${has(n)} a defect to fix before the next load`, hint: "Fix it, or confirm the repair on Defects.", short: "defect to fix now" },
  { key: "inspection_expired", tone: "danger", title: (n) => `${are(n)} past the annual inspection and must not be driven`, hint: "Every truck needs its periodic inspection every 12 months (49 CFR 396.17).", short: "annual inspection expired" },
  { key: "papers_expired", tone: "danger", title: (n) => `${has(n)} an expired registration or insurance`, hint: "A truck on the road with expired papers risks an out-of-service order.", short: "papers expired" },
  { key: "driver_papers", tone: "danger", title: (n) => `${has(n)} a driver with an expired licence or medical card`, hint: "The driver can't drive until it is renewed.", short: "driver's papers expired" },
  { key: "oil_overdue", tone: "danger", title: (n) => `${are(n)} overdue for an oil change`, hint: "Past the oil interval: book the shop now.", short: "oil overdue" },
  { key: "repair_late", tone: "danger", title: (n) => `${has(n)} a repair running late`, hint: "Past the date the shop promised, or booked and not taken in.", short: "repair late" },
  { key: "in_shop_no_ro", tone: "warn", title: (n) => `${are(n)} in shop without a repair order`, hint: "Open a repair so the work, the downtime and the cost are tracked.", short: "in shop, no repair order" },
  { key: "papers_30", tone: "warn", title: (n) => `${has(n)} a document expiring within a month`, hint: "Renewals take days; start them now.", short: "papers expiring" },
  { key: "papers_missing", tone: "warn", title: (n) => `${are(n)} missing a required document`, hint: "Registration, insurance or annual inspection not on file.", short: "papers missing" },
  { key: "oil_due", tone: "warn", title: (n) => `${are(n)} due for an oil change soon`, hint: "Booking the shop now avoids downtime.", short: "oil due soon" },
  { key: "repair_soon", tone: "warn", title: (n) => `${has(n)} a repair booked in the next 3 days`, hint: "Remind the driver and the shop.", short: "repair booked soon" },
  { key: "defect_open", tone: "warn", title: (n) => `${has(n)} open defects`, hint: "To fix within two weeks; give each an owner.", short: "open defects" },
  { key: "no_signal", tone: "warn", title: (n) => `${are(n)} not reporting their position`, hint: "No ELD position for 3 days or more.", short: "no position" },
  { key: "papers_60", tone: "info", title: (n) => `${has(n)} a document expiring within two months`, hint: "Book the renewal or the inspection.", short: "papers due in 2 months" },
  { key: "no_driver", tone: "info", title: (n) => `${has(n)} no driver`, hint: "In service with nobody assigned (Available).", short: "no driver" },
  { key: "no_reading", tone: "info", title: (n) => `${has(n)} no recent odometer reading`, hint: "The oil countdown is only a lower bound until someone enters one.", short: "no recent reading" },
  { key: "papers_90", tone: "info", title: (n) => `${has(n)} a document expiring within three months`, hint: "Nothing to do yet beyond planning.", short: "papers due in 3 months" },
] as const satisfies readonly Def[];

export type FindingKey = (typeof FINDINGS)[number]["key"];
export const FINDING_BY_KEY = Object.fromEntries(FINDINGS.map((d) => [d.key, d])) as Record<FindingKey, (typeof FINDINGS)[number]>;
export const isFinding = (v: string | undefined): v is FindingKey => Boolean(v && v in FINDING_BY_KEY);
/** Red and amber findings: the ones that count towards Needs attention. */
export const needsAction = (k: FindingKey) => FINDING_BY_KEY[k].tone !== "info";

export type FindingInput = {
  status: string;
  hasDriver: boolean;
  oil: ServiceState;
  /** Expiry per dated paper (REGISTRATION, INSURANCE, INSPECTION…), the earlier of the record and the newest file. */
  expiry: Record<string, Date | null>;
  missingPapers: number;
  defects?: { open: number; urgent: number };
  driver?: { licenseExpiry: Date | null; medicalExpiry: Date | null } | null;
  /** Open repair orders (booked or in the shop). */
  repairs: { status: string; scheduledAt: Date; promisedAt: Date | null }[];
  /** The company has an ELD connection, so every truck is expected to report. */
  tracked: boolean;
  lastPingAt: Date | null;
};

/** Every finding for one truck, worst first. */
export function truckFindings(x: FindingInput, now: Date, todayStart: Date): FindingKey[] {
  if (x.status === "INACTIVE") return [];
  const out = new Set<FindingKey>();
  const days = (d: Date) => Math.floor((d.getTime() - now.getTime()) / DAY);

  if (x.status === "OUT_OF_SERVICE") out.add("oos");
  if (x.defects?.urgent) out.add("defect_now");
  let soonest: number | null = null;
  for (const [kind, d] of Object.entries(x.expiry)) {
    if (!d) continue;
    const left = days(d);
    if (left < 0) out.add(kind === "INSPECTION" ? "inspection_expired" : "papers_expired");
    else soonest = soonest == null ? left : Math.min(soonest, left);
  }
  const expired = (d: Date | null) => d != null && d.getTime() < now.getTime();
  if (x.driver && (expired(x.driver.licenseExpiry) || expired(x.driver.medicalExpiry))) out.add("driver_papers");
  if (x.oil === "overdue") out.add("oil_overdue");
  const soonEnd = todayStart.getTime() + 3 * DAY;
  for (const r of x.repairs) {
    if (r.status === "IN_PROGRESS" && r.promisedAt && r.promisedAt.getTime() < now.getTime()) out.add("repair_late");
    if (r.status !== "IN_PROGRESS" && r.scheduledAt.getTime() < todayStart.getTime()) out.add("repair_late");
    if (r.status !== "IN_PROGRESS" && r.scheduledAt.getTime() >= todayStart.getTime() && r.scheduledAt.getTime() < soonEnd) out.add("repair_soon");
  }
  if (x.status === "MAINTENANCE" && !x.repairs.some((r) => r.status === "IN_PROGRESS")) out.add("in_shop_no_ro");
  if (soonest != null && soonest <= 30) out.add("papers_30");
  if (x.missingPapers > 0) out.add("papers_missing");
  if (x.oil === "due_now" || x.oil === "due_soon") out.add("oil_due");
  if (x.defects && x.defects.open > x.defects.urgent) out.add("defect_open");
  if (x.tracked && (!x.lastPingAt || now.getTime() - x.lastPingAt.getTime() > NO_SIGNAL_MS)) out.add("no_signal");
  if (soonest != null && soonest > 30 && soonest <= 60) out.add("papers_60");
  if (x.status === "ACTIVE" && !x.hasDriver) out.add("no_driver");
  if (x.oil === "no_reading") out.add("no_reading");
  if (soonest != null && soonest > 60 && soonest <= 90) out.add("papers_90");
  return FINDINGS.map((d) => d.key).filter((k) => out.has(k));
}
