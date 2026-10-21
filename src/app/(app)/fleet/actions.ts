"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { TRAILER_STATUSES, TRAILER_STATUS_LABELS, TRUCK_STATUSES, WORK_ORDER_STATUSES, humanize } from "@/lib/constants";
import { saveTruck as saveTruckRecord, setWorkOrderStatus as applyWorkOrderStatus } from "@/app/actions/fleet";
import { TRUCK_STATUS_LABELS, UNHOOKED_TRAILER_STATUSES } from "./lib";

/*
 * Fleet module actions. They supersede saveTruck, saveTrailer, setTruckStatus and setTrailerStatus in
 * src/app/actions/fleet.ts (only this module used them) and wrap setWorkOrderStatus for the truck and trailer pages:
 *  - one rule for a status change whichever control makes it: a unit on an active load keeps its working status, and
 *    only statuses that leave the tractor (Dropped, Yard, Shop, Out of service) unpair a trailer — Empty stays paired,
 *    as the load workflow leaves it after delivery;
 *  - expected failures come back as ActionState. Thrown errors reach the client as a generic message in production
 *    builds, so a business rule's explanation would never be seen.
 */

const ACTIVE_LOAD = { in: ["ASSIGNED", "IN_TRANSIT"] };

/** The load a unit is committed to right now, if any. */
function activeLoadOf(unit: { truckId: string } | { trailerId: string }) {
  return db.load.findFirst({ where: { ...unit, status: ACTIVE_LOAD }, orderBy: { pickupAt: "asc" }, select: { reference: true } });
}

/** A truck on an active load stays Active until the load is recovered onto another unit. */
async function assertTruckCanTake(truckId: string, status: string) {
  if (status === "ACTIVE") return;
  const load = await activeLoadOf({ truckId });
  if (load) throw new FormError(`Truck is on ${load.reference} — recover the load first`);
}

/** A trailer on an active load stays In use until the load is delivered or recovered. */
async function assertTrailerCanTake(trailerId: string, status: string) {
  if (status === "IN_USE") return;
  const load = await activeLoadOf({ trailerId });
  if (load) throw new FormError(`Trailer is on ${load.reference} — deliver or recover the load first`);
}

/* ------------------------------------------------------------------ */
/* Trucks                                                              */
/* ------------------------------------------------------------------ */

/** Status menu on the truck page. */
export async function setTruckStatus(truckId: string, status: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!TRUCK_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, status: true } });
    if (!truck) throw new FormError("This truck no longer exists — refresh the page");
    if (truck.status !== status) {
      await assertTruckCanTake(truckId, status);
      await db.truck.update({ where: { id: truckId }, data: { status } });
      await audit(me.id, "status", "truck", truckId, `${truck.unitNumber} → ${status}`);
    }
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${truckId}`);
    return { ok: `${truck.unitNumber} is now ${(TRUCK_STATUS_LABELS[status] ?? humanize(status)).toLowerCase()}` };
  });
}

/** Add / edit truck form: the status guard above, then the shared save (which redirects to the truck page). */
export async function saveTruck(truckId: string | null, prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser("fleet.edit");
  const check = await attempt(async () => {
    const status = fields(fd).str("status");
    if (status && !TRUCK_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    if (!truckId || !status) return;
    const existing = await db.truck.findUnique({ where: { id: truckId }, select: { status: true } });
    if (!existing) throw new FormError("This truck no longer exists");
    if (existing.status !== status) await assertTruckCanTake(truckId, status);
  });
  if (check?.error) return check;
  return saveTruckRecord(truckId, prev, fd);
}

/* ------------------------------------------------------------------ */
/* Trailers                                                            */
/* ------------------------------------------------------------------ */

/** Inline status control on the trailer list and the trailer page. Dropped / Yard pass the place they were left. */
export async function setTrailerStatus(trailerId: string, status: string, locationName?: string | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!TRAILER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const trailer = await db.trailer.findUnique({ where: { id: trailerId }, select: { unitNumber: true, status: true, truckId: true } });
    if (!trailer) throw new FormError("This trailer no longer exists — refresh the page");
    const unhook = UNHOOKED_TRAILER_STATUSES.includes(status) && trailer.truckId !== null;
    if (trailer.status !== status) {
      await assertTrailerCanTake(trailerId, status);
      const place = locationName?.trim() || null;
      await db.trailer.update({
        where: { id: trailerId },
        data: { status, statusSince: new Date(), ...(place ? { locationName: place } : {}), ...(unhook ? { truckId: null } : {}) },
      });
      await audit(me.id, "status", "trailer", trailerId, `${trailer.unitNumber} → ${status}${unhook ? " (unpaired)" : ""}`);
    }
    revalidatePath("/fleet/trailers");
    revalidatePath(`/fleet/trailers/${trailerId}`);
    if (trailer.truckId) revalidatePath(`/fleet/${trailer.truckId}`);
    return { ok: `${trailer.unitNumber} is now ${(TRAILER_STATUS_LABELS[status] ?? humanize(status)).toLowerCase()}` };
  });
}

/** Add / edit trailer form. Same status and pairing rules as the status control; opens the trailer page when saved. */
export async function saveTrailer(trailerId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let id = trailerId;
  const trucks = new Set<string>(); // truck pages whose paired-trailer list may change
  const res = await attempt(async () => {
    const f = fields(fd);
    const status = f.str("status") ?? "YARD";
    if (!TRAILER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const truckId = UNHOOKED_TRAILER_STATUSES.includes(status) ? null : f.str("truckId");
    const data = {
      unitNumber: f.req("unitNumber", "Unit number"),
      type: f.req("type", "Type"),
      capacityKg: f.num("capacityKg") ?? 20000,
      plate: f.str("plate"),
      year: f.num("year"),
      status,
      truckId,
      gpsProvider: f.str("gpsProvider"),
      insuranceExpiry: f.date("insuranceExpiry"),
      inspectionExpiry: f.date("inspectionExpiry"),
      locationName: f.str("locationName"),
      notes: f.str("notes"),
    };

    let saved: { id: string };
    if (trailerId) {
      const existing = await db.trailer.findUnique({ where: { id: trailerId }, select: { status: true, statusSince: true, truckId: true } });
      if (!existing) throw new FormError("This trailer no longer exists");
      if (existing.status !== status) await assertTrailerCanTake(trailerId, status);
      if (existing.truckId !== truckId) {
        const load = await activeLoadOf({ trailerId });
        if (load) throw new FormError(`Trailer is on ${load.reference} — recover the load to move it to another truck`);
      }
      saved = await db.trailer.update({
        where: { id: trailerId },
        data: { ...data, statusSince: existing.status === status ? existing.statusSince : new Date() },
      });
      if (existing.truckId) trucks.add(existing.truckId);
    } else {
      saved = await db.trailer.create({ data: { ...data, statusSince: new Date() } });
    }
    id = saved.id;
    if (truckId) trucks.add(truckId);
    await audit(me.id, trailerId ? "update" : "create", "trailer", saved.id, data.unitNumber);
  });
  if (res?.error) return res;
  revalidatePath("/fleet/trailers");
  revalidatePath(`/fleet/trailers/${id}`);
  for (const t of trucks) revalidatePath(`/fleet/${t}`);
  redirect(`/fleet/trailers/${id}`);
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

/**
 * Work-order buttons on the truck and trailer pages. A work order someone else already moved on (this page is stale) is
 * not moved again — re-running Start or Complete would put the unit back into, or out of, the shop.
 */
export async function setWorkOrderStatus(id: string, status: string): Promise<ActionState> {
  await requireUser("fleet.edit");
  return attempt(async () => {
    if (!WORK_ORDER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const wo = await db.workOrder.findUnique({ where: { id }, select: { number: true, status: true, truckId: true, trailerId: true } });
    if (!wo) throw new FormError("This work order no longer exists — refresh the page");
    if (wo.trailerId) revalidatePath(`/fleet/trailers/${wo.trailerId}`);
    if (wo.status === status || wo.status === "DONE" || wo.status === "CANCELLED") {
      if (wo.truckId) revalidatePath(`/fleet/${wo.truckId}`);
      throw new FormError(`Work order #${wo.number} is already ${humanize(wo.status).toLowerCase()}`);
    }
    await applyWorkOrderStatus(id, status);
    return { ok: `Work order #${wo.number} is now ${humanize(status).toLowerCase()}` };
  });
}
