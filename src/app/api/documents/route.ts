import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, makeKey, saveFile } from "@/lib/storage";
import { canUploadDoc, ownerData, DOC_KIND_LABELS, type DocOwner, type DocTarget } from "@/lib/documents";
import { recomputeBillingStage } from "@/lib/workflow";
import { notifyDocumentUploaded } from "@/lib/notify";

const OWNERS: DocOwner[] = ["load", "truck", "trailer", "driver", "customer", "workOrder", "claim", "company"];

/** Multipart upload: file, kind, one of loadId/truckId/trailerId/driverId/customerId/workOrderId/claimId (or company=1), optional expiresAt/notes. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File is larger than 4 MB" }, { status: 413 });
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.includes(contentType)) return NextResponse.json({ error: `File type ${contentType} isn't allowed` }, { status: 415 });

  let target: DocTarget | null = null;
  if (form.get("company")) target = { type: "company", id: "company" };
  else {
    const type = OWNERS.find((o) => form.get(`${o}Id`));
    if (type) target = { type, id: String(form.get(`${type}Id`)) };
  }
  if (!target) return NextResponse.json({ error: "Missing target" }, { status: 400 });
  if (!(await canUploadDoc(user, target, kind))) return NextResponse.json({ error: "You can't upload this document here" }, { status: 403 });

  const expiresRaw = form.get("expiresAt");
  const expiresAt = typeof expiresRaw === "string" && expiresRaw ? new Date(expiresRaw) : null;
  const notes = typeof form.get("notes") === "string" ? String(form.get("notes")).trim() || null : null;

  const storageKey = makeKey(`${target.type}/${target.id}`, file.name);
  await saveFile(storageKey, Buffer.from(await file.arrayBuffer()), contentType);
  const doc = await db.document.create({
    data: {
      kind, name: file.name.slice(0, 200), storageKey, contentType, size: file.size,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null, notes,
      ...ownerData(target), uploadedById: user.id,
    },
  });
  await audit(user.id, "upload", "document", doc.id, `${DOC_KIND_LABELS[kind] ?? kind}: ${doc.name} (${target.type})`);
  if (target.type === "load") {
    await db.loadEvent.create({ data: { loadId: target.id, type: "DOCUMENT", message: `${DOC_KIND_LABELS[kind] ?? kind} uploaded · ${doc.name}`, userId: user.id } });
    await recomputeBillingStage(target.id, user.id);
    after(() => notifyDocumentUploaded(doc.id));
  }
  // Compliance docs with an expiry keep the unit's own expiry field in sync.
  if (expiresAt && target.type === "truck") {
    const field = kind === "INSURANCE" ? "insuranceExpiry" : kind === "INSPECTION" ? "inspectionExpiry" : kind === "REGISTRATION" ? "registrationExpiry" : null;
    if (field) await db.truck.update({ where: { id: target.id }, data: { [field]: expiresAt } });
  }
  if (expiresAt && target.type === "trailer") {
    const field = kind === "INSURANCE" ? "insuranceExpiry" : kind === "INSPECTION" ? "inspectionExpiry" : null;
    if (field) await db.trailer.update({ where: { id: target.id }, data: { [field]: expiresAt } });
  }
  if (expiresAt && target.type === "driver") {
    const field = kind === "LICENSE" ? "licenseExpiry" : kind === "MEDICAL" ? "medicalExpiry" : null;
    if (field) await db.driver.update({ where: { id: target.id }, data: { [field]: expiresAt } });
  }
  return NextResponse.json({ ok: true, id: doc.id });
}
