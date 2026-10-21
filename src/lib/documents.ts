import "server-only";
import type { Document } from "@prisma/client";
import { db } from "./db";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";

export const DOC_KINDS = {
  load: ["RC", "BOL", "POD", "CMR", "CUSTOMS", "INVOICE", "PHOTO", "OTHER"],
  truck: ["REGISTRATION", "INSURANCE", "INSPECTION", "LEASE", "PHOTO", "OTHER"],
  trailer: ["REGISTRATION", "INSURANCE", "INSPECTION", "LEASE", "PHOTO", "OTHER"],
  driver: ["LICENSE", "MEDICAL", "CONTRACT", "PASSPORT", "OTHER"],
  customer: ["CONTRACT", "SETUP_PACKET", "OTHER"],
  workOrder: ["ESTIMATE", "VENDOR_INVOICE", "PHOTO", "OTHER"],
  claim: ["CLAIM_PHOTO", "POLICE_REPORT", "ESTIMATE", "CORRESPONDENCE", "SETTLEMENT", "OTHER"],
  company: ["COMPANY_LICENSE", "COMPANY_INSURANCE", "TAX_CERT", "BANK_LETTER", "SOP", "OTHER"],
} as const;

export type DocOwner = keyof typeof DOC_KINDS;
export type DocTarget = { type: DocOwner; id: string };

/** Compliance documents every truck / trailer should have on file (drives "missing" alerts). */
export const REQUIRED_UNIT_DOCS = ["REGISTRATION", "INSURANCE", "INSPECTION"] as const;
export const REQUIRED_DRIVER_DOCS = ["LICENSE", "MEDICAL"] as const;

// Kinds a driver may upload for their own load (proof of delivery, photos, paperwork).
const DRIVER_LOAD_KINDS = ["POD", "PHOTO", "BOL", "CMR", "OTHER"];

export function targetOf(doc: Pick<Document, "loadId" | "truckId" | "trailerId" | "driverId" | "customerId" | "workOrderId" | "claimId" | "isCompany">): DocTarget | null {
  if (doc.loadId) return { type: "load", id: doc.loadId };
  if (doc.truckId) return { type: "truck", id: doc.truckId };
  if (doc.trailerId) return { type: "trailer", id: doc.trailerId };
  if (doc.driverId) return { type: "driver", id: doc.driverId };
  if (doc.customerId) return { type: "customer", id: doc.customerId };
  if (doc.workOrderId) return { type: "workOrder", id: doc.workOrderId };
  if (doc.claimId) return { type: "claim", id: doc.claimId };
  if (doc.isCompany) return { type: "company", id: "company" };
  return null;
}

async function isDriversLoad(user: CurrentUser, loadId: string) {
  if (!user.driver) return false;
  const load = await db.load.findUnique({ where: { id: loadId }, select: { driverId: true } });
  return load?.driverId === user.driver.id;
}

export async function canViewDocs(user: CurrentUser, t: DocTarget) {
  switch (t.type) {
    case "load": return can(user.role, "loads.view") || (await isDriversLoad(user, t.id));
    case "truck":
    case "trailer":
    case "workOrder": return can(user.role, "fleet.view");
    case "driver": return can(user.role, "drivers.view") || user.driver?.id === t.id;
    case "customer": return can(user.role, "customers.view");
    case "claim": return can(user.role, "claims.view");
    case "company": return user.role !== "DRIVER";
  }
}

export async function canUploadDoc(user: CurrentUser, t: DocTarget, kind: string) {
  if (!(DOC_KINDS[t.type] as readonly string[]).includes(kind)) return false;
  switch (t.type) {
    case "load":
      if (can(user.role, "loads.edit")) return true;
      if (kind === "INVOICE" && can(user.role, "finance.edit")) return true;
      return DRIVER_LOAD_KINDS.includes(kind) && (await isDriversLoad(user, t.id));
    case "truck":
    case "trailer":
    case "workOrder": return can(user.role, "fleet.edit");
    case "driver": return can(user.role, "drivers.edit") || (user.driver?.id === t.id && ["LICENSE", "MEDICAL", "PASSPORT"].includes(kind));
    case "customer": return can(user.role, "customers.edit");
    case "claim": return can(user.role, "claims.edit");
    case "company": return can(user.role, "company.manage");
  }
}

export async function canDeleteDoc(user: CurrentUser, doc: Document) {
  if (doc.uploadedById === user.id) return true;
  if (can(user.role, "users.manage")) return true;
  const t = targetOf(doc);
  if (!t) return false;
  switch (t.type) {
    case "load": return can(user.role, "loads.edit");
    case "truck": case "trailer": case "workOrder": return can(user.role, "fleet.edit");
    case "driver": return can(user.role, "drivers.edit");
    case "customer": return can(user.role, "customers.edit");
    case "claim": return can(user.role, "claims.edit");
    case "company": return can(user.role, "company.manage");
  }
}

/** Prisma `where` / `data` fragment that ties a document to its owner. */
export function ownerData(t: DocTarget): Record<string, string | boolean> {
  switch (t.type) {
    case "load": return { loadId: t.id };
    case "truck": return { truckId: t.id };
    case "trailer": return { trailerId: t.id };
    case "driver": return { driverId: t.id };
    case "customer": return { customerId: t.id };
    case "workOrder": return { workOrderId: t.id };
    case "claim": return { claimId: t.id };
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
  RC: "Rate confirmation", BOL: "Bill of lading", POD: "Proof of delivery", CMR: "CMR waybill", CUSTOMS: "Customs", INVOICE: "Invoice",
  PHOTO: "Photo", LICENSE: "Driving license", MEDICAL: "Medical certificate", PASSPORT: "Passport / ID", INSURANCE: "Insurance",
  REGISTRATION: "Registration", INSPECTION: "Technical inspection", LEASE: "Lease agreement", CONTRACT: "Contract", SETUP_PACKET: "Setup packet",
  ESTIMATE: "Estimate", VENDOR_INVOICE: "Vendor invoice", CLAIM_PHOTO: "Claim photo", POLICE_REPORT: "Police report",
  CORRESPONDENCE: "Correspondence", SETTLEMENT: "Settlement", COMPANY_LICENSE: "Company licence", COMPANY_INSURANCE: "Company insurance",
  TAX_CERT: "Tax certificate", BANK_LETTER: "Bank letter", SOP: "SOP", OTHER: "Other",
};
