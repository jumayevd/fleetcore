import "server-only";
import type { Document } from "@prisma/client";
import { db } from "./db";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";

export const DOC_KINDS = {
  truck: ["REGISTRATION", "INSPECTION", "INSURANCE", "IFTA", "TITLE", "LEASE", "PERMIT", "WARRANTY", "BILL_OF_SALE", "PHOTO", "OTHER"],
  trailer: ["REGISTRATION", "INSPECTION", "INSURANCE", "TITLE", "LEASE", "PERMIT", "PHOTO", "OTHER"],
  driver: ["LICENSE", "MEDICAL", "CONTRACT", "PASSPORT", "OTHER"],
  workOrder: ["INVOICE", "ESTIMATE", "VENDOR_INVOICE", "PHOTO", "OTHER"],
  roadside: ["INSPECTION_REPORT", "CORRECTION", "PHOTO", "OTHER"],
  company: ["COMPANY_LICENSE", "COMPANY_INSURANCE", "TAX_CERT", "BANK_LETTER", "SOP", "OTHER"],
} as const;

/** The slots a unit page shows, in order, even when empty (anything else is listed under "Other files"). */
export const UNIT_DOC_SLOTS = {
  truck: ["REGISTRATION", "INSPECTION", "INSURANCE", "IFTA", "TITLE", "LEASE", "PERMIT", "WARRANTY", "BILL_OF_SALE"],
  trailer: ["REGISTRATION", "INSPECTION", "INSURANCE", "TITLE", "LEASE", "PERMIT"],
} as const;

/** Kinds that carry an issued and an expiry date. */
export const DATED_DOC_KINDS: readonly string[] = ["REGISTRATION", "INSPECTION", "INSURANCE", "IFTA", "PERMIT", "WARRANTY", "LEASE", "LICENSE", "MEDICAL", "COMPANY_LICENSE", "COMPANY_INSURANCE"];

export type DocOwner = keyof typeof DOC_KINDS;
export type DocTarget = { type: DocOwner; id: string };

/** Compliance documents every truck / trailer should have on file (drives "missing" alerts). */
export const REQUIRED_UNIT_DOCS = ["REGISTRATION", "INSURANCE", "INSPECTION"] as const;
export const REQUIRED_DRIVER_DOCS = ["LICENSE", "MEDICAL"] as const;

export function targetOf(doc: Pick<Document, "truckId" | "trailerId" | "driverId" | "workOrderId" | "roadsideId" | "isCompany">): DocTarget | null {
  if (doc.truckId) return { type: "truck", id: doc.truckId };
  if (doc.trailerId) return { type: "trailer", id: doc.trailerId };
  if (doc.driverId) return { type: "driver", id: doc.driverId };
  if (doc.workOrderId) return { type: "workOrder", id: doc.workOrderId };
  if (doc.roadsideId) return { type: "roadside", id: doc.roadsideId };
  if (doc.isCompany) return { type: "company", id: "company" };
  return null;
}

// Documents are already limited to the active company by the db scope; these are the role rules inside it.

export async function canViewDocs(user: CurrentUser, t: DocTarget) {
  switch (t.type) {
    case "truck":
    case "trailer":
    case "workOrder":
    case "roadside": return can(user.role, "fleet.view");
    case "driver": return can(user.role, "drivers.view");
    case "company": return true;
  }
}

export async function canUploadDoc(user: CurrentUser, t: DocTarget, kind: string) {
  if (!(DOC_KINDS[t.type] as readonly string[]).includes(kind)) return false;
  switch (t.type) {
    case "truck":
    case "trailer":
    case "workOrder":
    case "roadside": return can(user.role, "fleet.edit");
    case "driver": return can(user.role, "drivers.edit");
    case "company": return can(user.role, "company.manage");
  }
}

export async function canDeleteDoc(user: CurrentUser, doc: Document) {
  if (doc.uploadedById === user.id && user.role !== "VIEWER") return true;
  if (can(user.role, "company.manage")) return true;
  const t = targetOf(doc);
  if (!t) return false;
  switch (t.type) {
    case "truck": case "trailer": case "workOrder": case "roadside": return can(user.role, "fleet.edit");
    case "driver": return can(user.role, "drivers.edit");
    case "company": return can(user.role, "company.manage");
  }
}

/** Prisma `where` / `data` fragment that ties a document to its owner. */
export function ownerData(t: DocTarget): Record<string, string | boolean> {
  switch (t.type) {
    case "truck": return { truckId: t.id };
    case "trailer": return { trailerId: t.id };
    case "driver": return { driverId: t.id };
    case "workOrder": return { workOrderId: t.id };
    case "roadside": return { roadsideId: t.id };
    case "company": return { isCompany: true };
  }
}

export async function listDocs(t: DocTarget) {
  return db.document.findMany({
    where: ownerData(t),
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });
}

export const DOC_KIND_LABELS: Record<string, string> = {
  PHOTO: "Photo", LICENSE: "Driving license", MEDICAL: "Medical certificate", PASSPORT: "Passport / ID", INSURANCE: "Insurance",
  REGISTRATION: "Vehicle registration", INSPECTION: "Annual inspection", LEASE: "Lease agreement", PERMIT: "Permit", CONTRACT: "Contract",
  IFTA: "IFTA licence", TITLE: "Title", WARRANTY: "Warranty", BILL_OF_SALE: "Bill of sale", INVOICE: "Shop invoice",
  INSPECTION_REPORT: "Inspection report", CORRECTION: "Proof of correction",
  ESTIMATE: "Estimate", VENDOR_INVOICE: "Vendor invoice", COMPANY_LICENSE: "Company licence", COMPANY_INSURANCE: "Company insurance",
  TAX_CERT: "Tax certificate", BANK_LETTER: "Bank letter", SOP: "SOP", OTHER: "Other",
};
