import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DOC_KIND_LABELS, REQUIRED_DRIVER_DOCS, REQUIRED_UNIT_DOCS } from "@/lib/documents";
import { TRAILER_OFF_PAPERWORK, TRAILER_STATUS_LABELS, humanize } from "@/lib/constants";
import { daysUntil, type Kit } from "./kit";

/*
 * Paperwork for the assistant: the dates on the record plus the newest uploaded file, per truck, trailer, driver and
 * the company. Same rules as the truck page: a paper expires on the earlier of the two dates; expiring = within 30 days.
 */

/** Hard ceiling on rows read for checks that run in memory. */
export const SCAN = 1000;
/** Paperwork expiring inside this many days counts as expiring (same window as the fleet pages). */
export const EXPIRY_SOON_DAYS = 30;

type DocHit = { expiresAt: Date | null; name: string };
/** ownerId → kind (or "OTHER:<name>") → newest uploaded document. */
export type DocIndex = Map<string, Map<string, DocHit>>;
const PAPER_KINDS = [...REQUIRED_UNIT_DOCS, ...REQUIRED_DRIVER_DOCS] as string[];
const docKey = (kind: string, name: string) => (kind === "OTHER" ? `OTHER:${name}` : kind);

/** Newest document per owner and kind: the required kinds, plus any other document that carries an expiry date. */
export async function docIndex(owner: "truck" | "trailer" | "driver", ids?: string[]): Promise<DocIndex> {
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
export const emptyIndex = (): DocIndex => new Map();

type PaperState = "expired" | "expiring" | "ok" | "no date";
export type Paper = {
  kind: string; label: string; required: boolean; onFile: boolean;
  record: Date | null; fileExpiry: Date | null; date: Date | null; days: number | null; state: PaperState;
};

function paper(kind: string, record: Date | null, hit: DocHit | undefined, required: boolean, now: number): Paper {
  const fileExpiry = hit?.expiresAt ?? null;
  const date = record && fileExpiry ? (record < fileExpiry ? record : fileExpiry) : (record ?? fileExpiry);
  const days = daysUntil(date, now);
  const state: PaperState = days == null ? "no date" : days < 0 ? "expired" : days <= EXPIRY_SOON_DAYS ? "expiring" : "ok";
  const label = kind === "OTHER" && hit ? hit.name : (DOC_KIND_LABELS[kind] ?? humanize(kind));
  return { kind, label, required, onFile: Boolean(hit), record, fileExpiry, date, days, state };
}

function papersOf(required: readonly string[], records: Record<string, Date | null>, docs: Map<string, DocHit> | undefined, now: number): Paper[] {
  const out = required.map((kind) => paper(kind, records[kind] ?? null, docs?.get(kind), true, now));
  for (const [key, hit] of docs ?? []) {
    const kind = key.startsWith("OTHER:") ? "OTHER" : key;
    if (!required.includes(kind) && hit.expiresAt) out.push(paper(kind, null, hit, false, now));
  }
  return out;
}

export const truckPapers = (t: { insuranceExpiry: Date | null; inspectionExpiry: Date | null; registrationExpiry: Date | null }, docs: Map<string, DocHit> | undefined, now: number) =>
  papersOf(REQUIRED_UNIT_DOCS, { REGISTRATION: t.registrationExpiry, INSURANCE: t.insuranceExpiry, INSPECTION: t.inspectionExpiry }, docs, now);
export const trailerPapers = (t: { insuranceExpiry: Date | null; inspectionExpiry: Date | null }, docs: Map<string, DocHit> | undefined, now: number) =>
  papersOf(REQUIRED_UNIT_DOCS, { INSURANCE: t.insuranceExpiry, INSPECTION: t.inspectionExpiry }, docs, now);
export const driverPapers = (d: { licenseExpiry: Date; medicalExpiry: Date | null }, docs: Map<string, DocHit> | undefined, now: number) =>
  papersOf(REQUIRED_DRIVER_DOCS, { LICENSE: d.licenseExpiry, MEDICAL: d.medicalExpiry }, docs, now);

export function paperView(p: Paper, kit: Kit) {
  const differs = p.record && p.fileExpiry && p.record.getTime() !== p.fileExpiry.getTime();
  return {
    paper: p.label, expires: kit.date(p.date), daysLeft: p.days, state: p.state, fileOnRecord: p.onFile,
    ...(differs ? { recordDate: kit.date(p.record), fileExpiry: kit.date(p.fileExpiry) } : {}),
  };
}

export type PaperFilter = "expired" | "expiring" | "expired_or_expiring" | "missing";
/** Does this set of papers match a list filter? */
export function papersMatch(papers: Paper[], f: PaperFilter) {
  switch (f) {
    case "expired": return papers.some((p) => p.state === "expired");
    case "expiring": return papers.some((p) => p.state === "expiring");
    case "expired_or_expiring": return papers.some((p) => p.state === "expired" || p.state === "expiring");
    case "missing": return papers.some((p) => p.required && !p.onFile);
  }
}

export type HolderType = "truck" | "trailer" | "driver" | "company";
/** Something that must keep paperwork: a truck, a trailer, a driver, or the company itself. */
export type Holder = { owner: HolderType; id: string; name: string; status: string; active: boolean; assigned: string | null; onHold?: boolean; href: string | undefined; papers: Paper[] };

const truckStatusLabel = (s: string) => (s === "MAINTENANCE" ? "In maintenance" : s === "VENDOR" ? "At a vendor" : humanize(s));

/** Every unit and driver still in use with its papers. Inactive trucks, out-of-service and inactive trailers and former drivers are left out. */
export async function loadPaperwork(kit: Kit, now: number) {
  const { link, seesDrivers } = kit;
  const [trucks, trailers, drivers, truckDocs, trailerDocs, driverDocs, companyDocs] = await Promise.all([
    db.truck.findMany({
      where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" }, take: SCAN,
      select: { id: true, unitNumber: true, status: true, insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true, driver: { select: { name: true } } },
    }),
    db.trailer.findMany({
      where: { status: { notIn: TRAILER_OFF_PAPERWORK } }, orderBy: { unitNumber: "asc" }, take: SCAN,
      select: { id: true, unitNumber: true, status: true, insuranceExpiry: true, inspectionExpiry: true, truck: { select: { unitNumber: true } } },
    }),
    seesDrivers
      ? db.driver.findMany({
        where: { status: { not: "INACTIVE" } }, orderBy: { name: "asc" }, take: SCAN,
        select: { id: true, name: true, status: true, hold: true, licenseExpiry: true, medicalExpiry: true, truck: { select: { unitNumber: true } } },
      })
      : [],
    docIndex("truck"),
    docIndex("trailer"),
    seesDrivers ? docIndex("driver") : emptyIndex(),
    db.document.findMany({ where: { isCompany: true, expiresAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 500, select: { kind: true, name: true, expiresAt: true } }),
  ]);
  const holders: Holder[] = [
    ...trucks.map((t): Holder => ({
      owner: "truck", id: t.id, name: t.unitNumber, status: truckStatusLabel(t.status), active: t.status === "ACTIVE", assigned: t.driver?.name ?? null,
      href: link(`/fleet/${t.id}`), papers: truckPapers(t, truckDocs.get(t.id), now),
    })),
    ...trailers.map((t): Holder => ({
      owner: "trailer", id: t.id, name: t.unitNumber, status: TRAILER_STATUS_LABELS[t.status] ?? humanize(t.status), active: t.status === "IN_USE", assigned: t.truck?.unitNumber ?? null,
      href: link(`/fleet/trailers/${t.id}`), papers: trailerPapers(t, trailerDocs.get(t.id), now),
    })),
    ...drivers.map((d): Holder => ({
      owner: "driver", id: d.id, name: d.name, status: humanize(d.status), active: d.status === "ACTIVE", assigned: d.truck?.unitNumber ?? null, onHold: d.hold,
      href: link(`/drivers/${d.id}`), papers: driverPapers(d, driverDocs.get(d.id), now),
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
