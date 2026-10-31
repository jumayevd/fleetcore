"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { EQUIPMENT, INACTIVE_REASONS, INACTIVE_REASON_LABELS, TRAILER_STATUSES, TRAILER_STATUS_LABELS, TRUCK_STATUSES, humanize } from "@/lib/constants";
import { getFormat } from "@/lib/format-server";
import { parseDateInput } from "@/lib/locale";
import { defectLabel, roLabel } from "@/lib/service";
import { setTruckDriver } from "@/lib/assignments";
import { can } from "@/lib/permissions";
import { deleteFile } from "@/lib/storage";
import { placeFromText, truckStatusLabel, UNHOOKED_TRAILER_STATUSES } from "./lib";

/*
 * Fleet module actions: truck status, trailer create / edit / status / one-click fixes. The truck form saves through
 * saveTruck in src/app/actions/fleet.ts; repair orders live in src/app/actions/repairs.ts.
 *  - one rule for a trailer status change whichever control makes it: statuses that leave the tractor (Dropped, Yard,
 *    In shop, Out of service, Inactive) unpair it; In use and Empty stay paired;
 *  - expected failures come back as ActionState. Thrown errors reach the client as a generic message in production
 *    builds, so a business rule's explanation would never be seen.
 */

/* ------------------------------------------------------------------ */
/* Trucks                                                              */
/* ------------------------------------------------------------------ */

export type InactiveDetails = { reason?: string | null; note?: string | null; date?: string | null };

/**
 * Status menu on the truck page and the status pill on the trucks list. Available / Assigned follow the driver (ACTIVE
 * either way). In shop only comes from a repair order in the shop (the menu opens one) and Out of service only from a
 * defect that holds the truck; while either has the truck, its status changes through that repair or defect.
 * Inactive needs a reason (details too for Other) and a day, and takes the driver off the truck that day.
 */
export async function setTruckStatus(truckId: string, status: string, details?: InactiveDetails): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  return attempt(async () => {
    if (!TRUCK_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, status: true, driverId: true } });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    const u = truck.unitNumber;
    if (truck.status === status && status !== "INACTIVE") return { ok: `${u} is already ${truckStatusLabel(status, Boolean(truck.driverId)).toLowerCase()}` };
    if (status === "MAINTENANCE") throw new FormError(`Open a repair order to put ${u} in the shop.`);
    if (status === "OUT_OF_SERVICE") throw new FormError(`Out of service comes from a defect to fix before the next load. Report one on ${u} to hold it.`);
    if (truck.status !== status) {
      const [inShop, holding] = await Promise.all([
        db.workOrder.findFirst({ where: { truckId, status: "IN_PROGRESS", voidedAt: null }, select: { number: true } }),
        db.defect.findFirst({ where: { truckId, holdsUnit: true, status: { not: "CLOSED" } }, select: { number: true } }),
      ]);
      if (inShop) throw new FormError(`${roLabel(inShop.number)} has ${u} in the shop. Complete or void it to bring the truck back.`);
      if (holding) throw new FormError(`${defectLabel(holding.number)} holds ${u} out of service until someone confirms the repair.`);
    }

    const now = new Date();
    let data: Prisma.TruckUncheckedUpdateInput = { status, statusReason: null, statusNote: null, statusSince: now };
    let ended = false;
    if (status === "INACTIVE") {
      const reason = details?.reason ?? "";
      if (!(INACTIVE_REASONS as readonly string[]).includes(reason)) throw new FormError(`Pick why ${u} is inactive.`);
      const note = details?.note?.trim().slice(0, 500) || null;
      if (reason === "OTHER" && !note) throw new FormError(`Say why ${u} is inactive.`);
      const since = details?.date ? parseDateInput(details.date, me.company.timezone) : fmt.startOfDay(now);
      if (!since) throw new FormError("Pick a valid date.");
      if (since.getTime() > now.getTime()) throw new FormError("The date can't be in the future.");
      // An inactive truck has no driver: their stint ends the day it went inactive.
      if (truck.driverId) {
        await setTruckDriver({ truckId, driverId: null, day: since, userId: me.id, endNote: `Truck set inactive: ${INACTIVE_REASON_LABELS[reason].toLowerCase()}`, dayLabel: (d) => fmt.date(d) });
        ended = true;
      }
      data = { ...data, statusReason: reason, statusNote: note, statusSince: since };
    }
    await db.truck.update({ where: { id: truckId }, data });
    await audit(me.id, "status", "truck", truckId, `${u} → ${status}${data.statusReason ? ` (${INACTIVE_REASON_LABELS[String(data.statusReason)]}${data.statusNote ? `: ${data.statusNote}` : ""})` : ""}${ended ? " · driver unassigned" : ""}`);
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${truckId}`);
    revalidatePath("/dashboard");
    revalidatePath("/tracking");
    revalidatePath("/inspections");
    if (ended) revalidatePath("/drivers");
    if (truck.status === status) return { ok: `${u}: the inactive record is saved` };
    const label = (truckStatusLabel(status, Boolean(truck.driverId) && !ended) ?? humanize(status)).toLowerCase();
    return { ok: `${u} is now ${label}${ended ? " and no longer has a driver" : ""}` };
  });
}

/** Vendor is a flag, not a status: another company's or owner's truck, which keeps its own status. */
export async function setTruckVendor(truckId: string, isVendor: boolean): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, isVendor: true } });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    if (truck.isVendor !== isVendor) {
      await db.truck.update({ where: { id: truckId }, data: { isVendor } });
      await audit(me.id, "update", "truck", truckId, `${truck.unitNumber}: ${isVendor ? "marked as a vendor's truck" : "no longer a vendor's truck"}`);
    }
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${truckId}`);
    return { ok: isVendor ? `${truck.unitNumber} is a vendor's truck` : `${truck.unitNumber} is no longer a vendor's truck` };
  });
}

/**
 * Owners and admins: delete a truck or trailer added by mistake, with everything recorded on it (repairs, documents
 * and their files, defects, walk-arounds, fuel, driver history). `confirm` must be its unit number. Sold, stolen or
 * retired units belong in Inactive, which keeps their history.
 */
export async function deleteUnit(kind: "truck" | "trailer", id: string, confirm: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!can(me.role, "fleet.delete")) throw new FormError(`Only an owner or admin can delete a ${kind}.`);
    const unit = kind === "truck"
      ? await db.truck.findUnique({ where: { id }, select: { unitNumber: true, make: true, model: true } })
      : await db.trailer.findUnique({ where: { id }, select: { unitNumber: true, type: true, truckId: true } });
    if (!unit) throw new FormError(`This ${kind} no longer exists. It may have been deleted already.`);
    if (confirm.trim() !== unit.unitNumber) throw new FormError(`Type ${unit.unitNumber} to confirm.`);
    // Files of the unit, its repairs and (trucks) its pickup photos go with it; the rows cascade in the database.
    const docs = await db.document.findMany({
      where: kind === "truck"
        ? { OR: [{ truckId: id }, { workOrder: { truckId: id } }, { assignment: { truckId: id } }] }
        : { OR: [{ trailerId: id }, { workOrder: { trailerId: id } }] },
      select: { storageKey: true },
    });
    if (kind === "truck") await db.truck.delete({ where: { id } });
    else await db.trailer.delete({ where: { id } });
    await Promise.all(docs.map((d) => deleteFile(d.storageKey).catch(() => undefined)));
    await audit(me.id, "delete", kind, null, `${unit.unitNumber}${"make" in unit ? ` ${unit.make} ${unit.model}` : ""}${docs.length ? ` · ${docs.length} file${docs.length > 1 ? "s" : ""}` : ""}`);
    revalidatePath("/fleet");
    revalidatePath("/fleet/trailers");
    revalidatePath("/dashboard");
    revalidatePath("/tracking");
    revalidatePath("/inspections");
    revalidatePath("/maintenance");
    if ("truckId" in unit && unit.truckId) revalidatePath(`/fleet/${unit.truckId}`);
    return { ok: `${unit.unitNumber} deleted` };
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
  const fmt = await getFormat();
  let id = trailerId;
  const trucks = new Set<string>(); // truck pages whose paired-trailer list may change
  const res = await attempt(async () => {
    const f = fields(fd, me.company.timezone);
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
    const capacityKg = f.num("capacityKg") ?? (fmt.imperial ? 45000 : 20000);
    if (capacityKg < 0) throw new FormError("Capacity can't be negative");
    const data = {
      unitNumber,
      type,
      capacityKg: Math.round(capacityKg),
      plate: f.str("plate")?.toUpperCase() ?? null,
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

const TRAILER_COMPLETE_FIELDS = ["plate", "inspectionExpiry"] as const;

/** "Finish this trailer's record" prompts: the plate or the annual inspection date in one step (field `value`). */
export async function completeTrailer(trailerId: string, field: (typeof TRAILER_COMPLETE_FIELDS)[number], _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!TRAILER_COMPLETE_FIELDS.includes(field)) throw new FormError("That can't be set from here. Use Edit.");
    const trailer = await db.trailer.findUnique({ where: { id: trailerId }, select: { unitNumber: true } });
    if (!trailer) throw new FormError("This trailer no longer exists. Refresh the page.");
    const f = fields(fd, me.company.timezone);
    let data: Prisma.TrailerUncheckedUpdateInput;
    let done: string;
    if (field === "plate") {
      const plate = f.req("value", "Plate").toUpperCase();
      data = { plate };
      done = `Plate ${plate} saved`;
    } else {
      const at = f.date("value");
      if (!at) throw new FormError("Pick the date the annual inspection is due");
      data = { inspectionExpiry: at };
      done = "Annual inspection date saved";
    }
    await db.trailer.update({ where: { id: trailerId }, data });
    await audit(me.id, "update", "trailer", trailerId, `${trailer.unitNumber}: ${field}`);
    revalidatePath("/fleet/trailers");
    revalidatePath(`/fleet/trailers/${trailerId}`);
    revalidatePath("/dashboard");
    return { ok: done };
  });
}
