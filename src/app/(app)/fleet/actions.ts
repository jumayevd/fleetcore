"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { EQUIPMENT, TRAILER_STATUSES, TRAILER_STATUS_LABELS, TRUCK_STATUSES, WORK_ORDER_STATUSES, humanize } from "@/lib/constants";
import { setWorkOrderStatus as applyWorkOrderStatus } from "@/app/actions/fleet";
import { placeFromText, TRUCK_STATUS_LABELS, UNHOOKED_TRAILER_STATUSES } from "./lib";

/*
 * Fleet module actions: truck status, trailer create / edit / status, and the work-order buttons on the truck and
 * trailer pages. The truck form saves through saveTruck in src/app/actions/fleet.ts.
 *  - one rule for a trailer status change whichever control makes it: statuses that leave the tractor (Dropped, Yard,
 *    Shop, Out of service) unpair it; In use and Empty stay paired;
 *  - expected failures come back as ActionState. Thrown errors reach the client as a generic message in production
 *    builds, so a business rule's explanation would never be seen.
 */

/* ------------------------------------------------------------------ */
/* Trucks                                                              */
/* ------------------------------------------------------------------ */

/** Status menu on the truck page. */
export async function setTruckStatus(truckId: string, status: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!TRUCK_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, status: true } });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    if (truck.status !== status) {
      await db.truck.update({ where: { id: truckId }, data: { status } });
      await audit(me.id, "status", "truck", truckId, `${truck.unitNumber} → ${status}`);
    }
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${truckId}`);
    return { ok: `${truck.unitNumber} is now ${(TRUCK_STATUS_LABELS[status] ?? humanize(status)).toLowerCase()}` };
  });
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
    if (!trailer) throw new FormError("This trailer no longer exists. Refresh the page.");
    const unhook = UNHOOKED_TRAILER_STATUSES.includes(status) && trailer.truckId !== null;
    if (trailer.status !== status) {
      const place = locationName?.trim() || null;
      await db.trailer.update({
        where: { id: trailerId },
        data: { status, statusSince: new Date(), ...(place ? placeFromText(place) : {}), ...(unhook ? { truckId: null } : {}) },
      });
      await audit(me.id, "status", "trailer", trailerId, `${trailer.unitNumber} → ${status}${unhook ? " (unpaired)" : ""}`);
    }
    revalidatePath("/fleet/trailers");
    revalidatePath(`/fleet/trailers/${trailerId}`);
    if (trailer.truckId) revalidatePath(`/fleet/${trailer.truckId}`);
    const label = (TRAILER_STATUS_LABELS[status] ?? humanize(status)).toLowerCase();
    return { ok: `${trailer.unitNumber} is now ${label}${unhook ? " and no longer paired" : ""}` };
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
    const type = f.req("type", "Type");
    if (!EQUIPMENT.includes(type as never)) throw new FormError("Pick a valid trailer type");
    const unitNumber = f.req("unitNumber", "Unit number");
    const clash = await db.trailer.findFirst({ where: { unitNumber, ...(trailerId ? { id: { not: trailerId } } : {}) }, select: { id: true } });
    if (clash) throw new FormError(`There is already a trailer ${unitNumber}. Pick another unit number.`);
    const truckId = UNHOOKED_TRAILER_STATUSES.includes(status) ? null : f.str("truckId");
    if (truckId && !(await db.truck.findUnique({ where: { id: truckId }, select: { id: true } }))) {
      throw new FormError("That truck no longer exists. Reload the page and pick again.");
    }
    const capacityKg = f.num("capacityKg") ?? 20000;
    if (capacityKg < 0) throw new FormError("Capacity can't be negative");
    const data = {
      unitNumber,
      type,
      capacityKg: Math.round(capacityKg),
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
    // A place typed by hand moves the map pin: to the city it names, or off the map when it names none.
    const position = (name: string | null) => (name ? placeFromText(name) : { locationName: null, lat: null, lng: null });

    let saved: { id: string };
    if (trailerId) {
      const existing = await db.trailer.findUnique({ where: { id: trailerId }, select: { status: true, statusSince: true, truckId: true, locationName: true } });
      if (!existing) throw new FormError("This trailer no longer exists");
      const moved = (existing.locationName ?? null) !== data.locationName;
      saved = await db.trailer.update({
        where: { id: trailerId },
        data: { ...data, ...(moved ? position(data.locationName) : {}), statusSince: existing.status === status ? existing.statusSince : new Date() },
      });
      if (existing.truckId) trucks.add(existing.truckId);
    } else {
      saved = await db.trailer.create({ data: { ...data, ...position(data.locationName), statusSince: new Date() } });
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
    if (!wo) throw new FormError("This work order no longer exists. Refresh the page.");
    if (wo.status === status || wo.status === "DONE" || wo.status === "CANCELLED") {
      if (wo.truckId) revalidatePath(`/fleet/${wo.truckId}`);
      if (wo.trailerId) revalidatePath(`/fleet/trailers/${wo.trailerId}`);
      throw new FormError(`Work order #${wo.number} is already ${humanize(wo.status).toLowerCase()}`);
    }
    await applyWorkOrderStatus(id, status);
    return { ok: `Work order #${wo.number} is now ${humanize(status).toLowerCase()}` };
  });
}
