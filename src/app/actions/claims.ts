"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { CLAIM_FAULTS, CLAIM_SEVERITIES, CLAIM_STATUSES, CLAIM_TYPES } from "@/lib/constants";
import { nextClaimNumber } from "@/lib/workflow";
import { deleteFile } from "@/lib/storage";
import { notifyClaimOpened, notifyClaimStatus } from "@/lib/notify-claims";
import { allowedClaimTransitions, claimStatusLabel, isClosingStatus, type ClaimStatus } from "@/app/(app)/claims/shared";

const DAY = 86_400_000;

function revalidateClaim(claimId: string | null, loadId?: string | null) {
  revalidatePath("/claims");
  revalidatePath("/dashboard");
  if (claimId) revalidatePath(`/claims/${claimId}`);
  if (loadId) revalidatePath(`/loads/${loadId}`);
}

/** Make sure a referenced record exists, so a stale option never turns into a foreign-key 500. */
async function mustExist(label: string, id: string | null, find: (id: string) => Promise<unknown>) {
  if (!id) return;
  if (!(await find(id))) throw new FormError(`${label} not found — pick it again`);
}

/**
 * Create or edit a claim. New claims start as REPORTED; on edit, a status change in the form must
 * follow the transition map (the detail page's status buttons are the usual way to move a claim).
 * The form fills the driver, unit, customer and place from a picked load itself, so the server
 * saves what was sent: a field the user cleared stays empty. Only a new claim posted without those
 * fields at all (a bare "file from load" request) has them taken from the load.
 */
export async function saveClaim(claimId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("claims.edit");
  let id = claimId;
  let loadForRevalidate: string | null = null;
  const res = await attempt(async () => {
    const f = fields(fd);
    const type = f.req("type", "Claim type");
    if (!(CLAIM_TYPES as readonly string[]).includes(type)) throw new FormError("Invalid claim type");
    const severity = f.str("severity") ?? "MEDIUM";
    if (!(CLAIM_SEVERITIES as readonly string[]).includes(severity)) throw new FormError("Invalid severity");
    const fault = f.str("fault") ?? "UNKNOWN";
    if (!(CLAIM_FAULTS as readonly string[]).includes(fault)) throw new FormError("Invalid fault");
    const incidentAt = f.date("incidentAt");
    if (!incidentAt) throw new FormError("Incident date is required");
    if (incidentAt.getTime() > Date.now() + DAY) throw new FormError("Incident date can't be in the future");
    const description = f.req("description", "Description");
    const amountClaimed = f.num("amountClaimed") ?? 0;
    if (amountClaimed < 0) throw new FormError("Amount claimed can't be negative");
    const amountSettled = f.num("amountSettled");
    if (amountSettled != null && amountSettled < 0) throw new FormError("Amount settled can't be negative");

    let location = f.str("location");
    let driverId = f.str("driverId");
    let truckId = f.str("truckId");
    let trailerId = f.str("trailerId");
    let customerId = f.str("customerId");
    const loadId = f.str("loadId");
    const assignedToId = f.str("assignedToId");

    if (loadId) {
      const load = await db.load.findUnique({ where: { id: loadId }, select: { driverId: true, truckId: true, trailerId: true, customerId: true, brokerId: true, destName: true, destCity: true } });
      if (!load) throw new FormError("Load not found — pick it again");
      if (!claimId) {
        const unsent = (k: string) => !fd.has(k);
        if (unsent("driverId")) driverId = load.driverId;
        if (unsent("truckId")) truckId = load.truckId;
        if (unsent("trailerId")) trailerId = load.trailerId;
        if (unsent("customerId")) customerId = load.brokerId ?? load.customerId;
        if (unsent("location")) location = `${load.destName}, ${load.destCity}`;
      }
    }
    await Promise.all([
      mustExist("Driver", driverId, (x) => db.driver.findUnique({ where: { id: x }, select: { id: true } })),
      mustExist("Truck", truckId, (x) => db.truck.findUnique({ where: { id: x }, select: { id: true } })),
      mustExist("Trailer", trailerId, (x) => db.trailer.findUnique({ where: { id: x }, select: { id: true } })),
      mustExist("Customer", customerId, (x) => db.customer.findUnique({ where: { id: x }, select: { id: true } })),
      mustExist("Assignee", assignedToId, (x) => db.user.findFirst({ where: { id: x, active: true, role: { not: "DRIVER" } }, select: { id: true } })),
    ]);

    const data = { type, severity, fault, incidentAt, location, description, amountClaimed, amountSettled, driverId, loadId, truckId, trailerId, customerId, assignedToId };
    loadForRevalidate = loadId;

    if (claimId) {
      const existing = await db.claim.findUniqueOrThrow({ where: { id: claimId } });
      const requested = f.str("status");
      let statusChange: { status: ClaimStatus; closedAt: Date | null } | null = null;
      if (requested && requested !== existing.status) {
        if (!(CLAIM_STATUSES as readonly string[]).includes(requested)) throw new FormError("Invalid status");
        if (!allowedClaimTransitions(existing.status).includes(requested as ClaimStatus)) {
          throw new FormError(`A claim can't go from ${claimStatusLabel(existing.status).toLowerCase()} straight to ${claimStatusLabel(requested).toLowerCase()}`);
        }
        statusChange = { status: requested as ClaimStatus, closedAt: isClosingStatus(requested) ? existing.closedAt ?? new Date() : null };
      }
      await db.claim.update({ where: { id: claimId }, data: { ...data, ...(statusChange ?? {}) } });
      await audit(me.id, "update", "claim", claimId, `${existing.number} details updated`);
      if (existing.assignedToId !== assignedToId) {
        const who = assignedToId ? (await db.user.findUnique({ where: { id: assignedToId }, select: { name: true } }))?.name : null;
        await audit(me.id, "assign", "claim", claimId, `${existing.number} → ${who ?? "unassigned"}`);
      }
      if (statusChange) {
        await audit(me.id, "status", "claim", claimId, `${existing.number}: ${existing.status} → ${statusChange.status}`);
        after(() => notifyClaimStatus(claimId, statusChange.status));
      }
      if (existing.loadId && existing.loadId !== loadId) revalidatePath(`/loads/${existing.loadId}`);
    } else {
      const number = await nextClaimNumber();
      const claim = await db.claim.create({ data: { ...data, number, status: "REPORTED", createdById: me.id } });
      id = claim.id;
      await audit(me.id, "create", "claim", claim.id, `${number} · ${type.toLowerCase().replace(/_/g, " ")} · ${severity.toLowerCase()}`);
      after(() => notifyClaimOpened(claim.id));
    }
  });
  if (res?.error) return res;
  revalidateClaim(id, loadForRevalidate);
  redirect(`/claims/${id}`);
}

/**
 * Move a claim along its lifecycle. Only transitions in CLAIM_TRANSITIONS are accepted; paid, closed
 * and denied stamp `closedAt`, reopening (disputed) clears it. Returns an ActionState rather than
 * throwing so the message survives production error masking.
 */
async function setClaimStatus(claimId: string, status: string, extra: { amountSettled?: number | null; note?: string | null } = {}): Promise<ActionState> {
  const me = await requireUser("claims.edit");
  return attempt(async () => {
    if (!(CLAIM_STATUSES as readonly string[]).includes(status)) throw new FormError("Invalid status");
    const to = status as ClaimStatus;
    const claim = await db.claim.findUniqueOrThrow({ where: { id: claimId } });
    if (!allowedClaimTransitions(claim.status).includes(to)) {
      throw new FormError(`A claim can't go from ${claimStatusLabel(claim.status).toLowerCase()} straight to ${claimStatusLabel(to).toLowerCase()}`);
    }
    const settled = extra.amountSettled;
    if (settled != null && (Number.isNaN(settled) || settled < 0)) throw new FormError("Settled amount must be zero or more");
    const amountSettled = settled != null ? settled : to === "DENIED" && claim.amountSettled == null ? 0 : undefined;
    const closedAt = isClosingStatus(to) ? claim.closedAt ?? new Date() : null;
    await db.claim.update({ where: { id: claimId }, data: { status: to, closedAt, ...(amountSettled !== undefined ? { amountSettled } : {}) } });
    const note = extra.note?.trim() || null;
    if (note) await db.claimNote.create({ data: { claimId, userId: me.id, body: `${claimStatusLabel(to)}: ${note}` } });
    await audit(me.id, "status", "claim", claimId, `${claim.number}: ${claim.status} → ${to}${amountSettled !== undefined ? ` · settled ${amountSettled}` : ""}${note ? ` — ${note}` : ""}`);
    revalidateClaim(claimId, claim.loadId);
    after(() => notifyClaimStatus(claimId, to));
    return { ok: `${claim.number} is now ${claimStatusLabel(to).toLowerCase()}` };
  });
}

/** Anyone who can see claims can add to the thread (accounting leaves settlement notes without edit rights). */
export async function addClaimNote(claimId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("claims.view");
  return attempt(async () => {
    const body = fields(fd).req("body", "Note");
    if (body.length > 2000) throw new FormError("Keep notes under 2000 characters");
    const claim = await db.claim.findUniqueOrThrow({ where: { id: claimId }, select: { number: true } });
    await db.claimNote.create({ data: { claimId, userId: me.id, body } });
    await audit(me.id, "note", "claim", claimId, `${claim.number}: ${body.length > 120 ? `${body.slice(0, 119)}…` : body}`);
    revalidatePath(`/claims/${claimId}`);
    return { ok: "Note added" };
  });
}

/** Hand the claim to someone else (or nobody). */
export async function assignClaim(claimId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("claims.edit");
  return attempt(async () => {
    const assignedToId = fields(fd).str("assignedToId");
    const claim = await db.claim.findUniqueOrThrow({ where: { id: claimId }, select: { number: true, assignedToId: true } });
    if (claim.assignedToId === assignedToId) return { ok: "No change" };
    let who: string | null = null;
    if (assignedToId) {
      const u = await db.user.findFirst({ where: { id: assignedToId, active: true, role: { not: "DRIVER" } }, select: { name: true } });
      if (!u) throw new FormError("Pick an active staff member");
      who = u.name;
    }
    await db.claim.update({ where: { id: claimId }, data: { assignedToId } });
    await audit(me.id, "assign", "claim", claimId, `${claim.number} → ${who ?? "unassigned"}`);
    revalidateClaim(claimId);
    return { ok: who ? `Assigned to ${who}` : "Unassigned" };
  });
}

/** Permanent delete (users.manage). Notes and document rows cascade; stored files are removed too. */
export async function deleteClaim(claimId: string) {
  const me = await requireUser("users.manage");
  const claim = await db.claim.findUniqueOrThrow({ where: { id: claimId }, include: { documents: { select: { storageKey: true } } } });
  await db.claim.delete({ where: { id: claimId } });
  await Promise.allSettled(claim.documents.map((d) => deleteFile(d.storageKey)));
  await audit(me.id, "delete", "claim", claimId, `${claim.number} · ${claim.type.toLowerCase().replace(/_/g, " ")} · ${claim.status.toLowerCase().replace(/_/g, " ")}`);
  revalidateClaim(null, claim.loadId);
  redirect("/claims");
}

/**
 * Form-shaped wrapper around setClaimStatus for ActionForm: `status`, optional `amountSettled`
 * (approved / paid) and an optional `note` that lands in the thread with the new status.
 */
export async function moveClaimStatus(claimId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const raw = fd.get("amountSettled");
  const text = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  const amountSettled = text === null ? null : Number(text);
  if (amountSettled !== null && Number.isNaN(amountSettled)) return { error: "Settled amount must be a number" };
  const note = fd.get("note");
  return setClaimStatus(claimId, String(fd.get("status") ?? ""), { amountSettled, note: typeof note === "string" ? note : null });
}
