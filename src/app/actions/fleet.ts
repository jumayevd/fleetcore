"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { startOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { OWNERSHIP, TRUCK_STATUSES, WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from "@/lib/constants";
import { number, toDateInput } from "@/lib/format";
import { createWorkOrder } from "@/lib/work-orders";
import { ODOMETER_JUMP_KM, placeFromText, pmStatus } from "@/app/(app)/fleet/lib";

/* ------------------------------------------------------------------ */
/* Trucks                                                              */
/* ------------------------------------------------------------------ */

/** Add / edit truck form. Saving opens the truck page. */
export async function saveTruck(truckId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let id = truckId;
  const res = await attempt(async () => {
    const f = fields(fd);
    const status = f.str("status") ?? "ACTIVE";
    if (!TRUCK_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const ownership = f.str("ownership") ?? "COMPANY";
    if (!OWNERSHIP.includes(ownership as never)) throw new FormError("Pick a valid ownership");
    const unitNumber = f.req("unitNumber", "Unit number");
    const clash = await db.truck.findFirst({ where: { unitNumber, ...(truckId ? { id: { not: truckId } } : {}) }, select: { id: true } });
    if (clash) throw new FormError(`There is already a truck ${unitNumber}. Pick another unit number.`);

    const driverId = f.str("driverId");
    if (driverId) {
      const driver = await db.driver.findUnique({ where: { id: driverId }, select: { name: true, truck: { select: { id: true, unitNumber: true } } } });
      if (!driver) throw new FormError("That driver no longer exists. Reload the page and pick again.");
      if (driver.truck && driver.truck.id !== truckId) throw new FormError(`${driver.name} already drives ${driver.truck.unitNumber}. Unassign them there first.`);
    }
    const odometerKm = f.num("odometerKm") ?? 0;
    if (odometerKm < 0) throw new FormError("The odometer can't be negative");
    const leased = ownership === "LEASED";
    const data = {
      unitNumber,
      make: f.req("make", "Make"),
      model: f.req("model", "Model"),
      year: f.num("year") ?? new Date().getFullYear(),
      vin: f.str("vin"),
      plate: f.req("plate", "Plate"),
      status,
      ownership,
      group: f.str("group"),
      lessor: leased ? f.str("lessor") : null,
      leaseStartKm: leased ? f.num("leaseStartKm") : null,
      leaseAnnualLimitKm: leased ? f.num("leaseAnnualLimitKm") : null,
      leaseBufferPct: leased ? f.num("leaseBufferPct") : null,
      leaseOverageRate: leased ? f.num("leaseOverageRate") : null,
      odometerKm: Math.round(odometerKm),
      pmIntervalKm: f.num("pmIntervalKm") ?? 30000,
      lastPmKm: f.num("lastPmKm"),
      lastPmAt: f.date("lastPmAt"),
      nextServiceKm: f.num("nextServiceKm"),
      fuelType: f.str("fuelType") ?? "DIESEL",
      fuelCapacityL: f.num("fuelCapacityL") ?? 600,
      insuranceExpiry: f.date("insuranceExpiry"),
      inspectionExpiry: f.date("inspectionExpiry"),
      registrationExpiry: f.date("registrationExpiry"),
      notes: f.str("notes"),
      driverId,
    };
    if (truckId) {
      const before = await db.truck.findUnique({ where: { id: truckId }, select: { odometerKm: true } });
      if (!before) throw new FormError("This truck no longer exists.");
      await db.truck.update({ where: { id: truckId }, data });
      await audit(me.id, "update", "truck", truckId, data.unitNumber);
      // Logged like a saved reading, so the truck page knows how fresh the odometer is.
      if (before.odometerKm !== data.odometerKm) await audit(me.id, "readings", "truck", truckId, `odometer ${number(data.odometerKm)} km (edited)`);
    } else {
      // A new truck has no position until someone enters where it is (or a tracker reports one).
      const place = f.str("locationName");
      const where = place ? { ...placeFromText(place), pingSource: "MANUAL", lastPingAt: new Date() } : {};
      const t = await db.truck.create({ data: { ...data, ...where } });
      id = t.id;
      await audit(me.id, "create", "truck", t.id, data.unitNumber);
    }
  });
  if (res?.error) return res;
  revalidatePath("/fleet");
  redirect(`/fleet/${id}`);
}

// Truck status changes and trailer create / edit / status live in src/app/(app)/fleet/actions.ts.

export async function addTruckNote(truckId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const note = fields(fd).req("note", "Note");
    const t = await db.truck.findUnique({ where: { id: truckId }, select: { notes: true } });
    if (!t) throw new FormError("This truck no longer exists. Refresh the page.");
    const stamp = `${new Date().toISOString().slice(0, 10)} ${me.name}: ${note.replace(/\s*\n\s*/g, " ")}`;
    await db.truck.update({ where: { id: truckId }, data: { notes: t.notes ? `${stamp}\n${t.notes}` : stamp } });
    await audit(me.id, "note", "truck", truckId, note);
    revalidatePath(`/fleet/${truckId}`);
    return { ok: "Note added" };
  });
}

/**
 * "Update readings" on the truck page: odometer, fuel level and where the truck is. Without telematics this is what
 * keeps the PM countdown, the lease cap and the map honest. The odometer never goes backwards (or jumps by an
 * implausible amount) unless the person ticks "I've checked this reading".
 */
export async function updateTruckReadings(truckId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const f = fields(fd);
    const truck = await db.truck.findUnique({
      where: { id: truckId },
      select: { unitNumber: true, odometerKm: true, pmIntervalKm: true, lastPmKm: true, nextServiceKm: true },
    });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    const rawOdometer = f.num("odometerKm");
    const fuelPct = f.num("fuelPct");
    const place = f.str("locationName");
    const checked = f.bool("confirm");
    if (rawOdometer == null && fuelPct == null && !place) throw new FormError("Enter an odometer reading, a fuel level or a location");

    const data: Prisma.TruckUncheckedUpdateInput = {};
    const saved: string[] = [];
    let odometer: number | null = null;
    if (rawOdometer != null) {
      odometer = Math.round(rawOdometer);
      if (odometer < 0) throw new FormError("The odometer can't be negative");
      if (odometer < truck.odometerKm && !checked) {
        throw new FormError(`${truck.unitNumber} already reads ${number(truck.odometerKm)} km, so ${number(odometer)} km would wind it back. Check the reading, or tick "I've checked this reading" to correct it.`);
      }
      if (odometer - truck.odometerKm > ODOMETER_JUMP_KM && !checked) {
        throw new FormError(`That is ${number(odometer - truck.odometerKm)} km more than the last reading (${number(truck.odometerKm)} km). Check for an extra digit, or tick "I've checked this reading" to save it.`);
      }
      if (odometer !== truck.odometerKm) {
        data.odometerKm = odometer;
        saved.push(`odometer ${number(odometer)} km`);
      }
    }
    if (fuelPct != null) {
      if (fuelPct < 0 || fuelPct > 100) throw new FormError("Fuel level is a percentage from 0 to 100");
      data.fuelPct = Math.round(fuelPct);
      saved.push(`fuel ${Math.round(fuelPct)}%`);
    }
    let offMap = false;
    if (place) {
      const p = placeFromText(place);
      offMap = p.lat == null;
      // A hand-entered position is a fix with no live data: speed and engine state from an older ping no longer apply.
      Object.assign(data, { ...p, speedKmh: null, engineOn: null, pingSource: "MANUAL", lastPingAt: new Date() });
      saved.push(`location ${p.locationName}`);
    }
    if (!saved.length) return { ok: `Nothing changed: ${truck.unitNumber} already reads ${number(truck.odometerKm)} km` };

    await db.truck.update({ where: { id: truckId }, data });
    await audit(me.id, "readings", "truck", truckId, saved.join(", "));
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${truckId}`);
    revalidatePath("/maintenance");
    revalidatePath("/tracking");

    const parts = [`Saved ${saved.join(", ")}.`];
    if (data.odometerKm != null) {
      const pm = pmStatus({ ...truck, odometerKm: odometer ?? truck.odometerKm });
      if (pm.state === "overdue") parts.push(`PM is overdue by ${number(-(pm.left ?? 0))} km.`);
      else if (pm.state === "due") parts.push(`PM is due in ${number(pm.left ?? 0)} km.`);
    }
    if (offMap) parts.push("No known city in the location, so it is kept as text and not shown on the map.");
    return { ok: parts.join(" ") };
  });
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

type Unit = { truckId: string | null; trailerId: string | null };

function revalidateUnit(unit: Unit) {
  if (unit.truckId) revalidatePath(`/fleet/${unit.truckId}`);
  if (unit.trailerId) revalidatePath(`/fleet/trailers/${unit.trailerId}`);
  revalidatePath("/fleet");
  revalidatePath("/fleet/trailers");
}

/** Put a unit back in service once no other job holds it in the shop. */
async function releaseUnit(unit: Unit, workOrderId: string, now: Date) {
  if (unit.truckId) {
    const open = await db.workOrder.count({ where: { truckId: unit.truckId, status: "IN_PROGRESS", id: { not: workOrderId } } });
    if (!open) await db.truck.updateMany({ where: { id: unit.truckId, status: "MAINTENANCE" }, data: { status: "ACTIVE" } });
  }
  if (unit.trailerId) {
    const open = await db.workOrder.count({ where: { trailerId: unit.trailerId, status: "IN_PROGRESS", id: { not: workOrderId } } });
    if (!open) await db.trailer.updateMany({ where: { id: unit.trailerId, status: "SHOP" }, data: { status: "YARD", statusSince: now } });
  }
}

/**
 * Unit and record side effects of a work order reaching `status` (from `prevStatus`): starting puts the unit in the
 * shop; completing or cancelling a started job releases it (as does sending it back to open / draft); completing a
 * PM or inspection moves the truck's service and inspection dates, dated by when the unit left the shop.
 */
async function applyWorkOrderSideEffects(id: string, status: string, userId: string, prevStatus: string | null) {
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id }, include: { truck: true } });
  const now = new Date();
  if (status === "IN_PROGRESS") {
    await db.workOrder.update({ where: { id }, data: { inAt: wo.inAt ?? now } });
    if (wo.truckId) await db.truck.update({ where: { id: wo.truckId }, data: { status: "MAINTENANCE" } });
    if (wo.trailerId) await db.trailer.update({ where: { id: wo.trailerId }, data: { status: "SHOP", statusSince: now, truckId: null } });
  }
  if ((status === "OPEN" || status === "DRAFT") && prevStatus === "IN_PROGRESS") await releaseUnit(wo, id, now);
  if (status === "CANCELLED" && (prevStatus === "IN_PROGRESS" || (wo.inAt && !wo.outAt))) {
    if (wo.inAt && !wo.outAt) await db.workOrder.update({ where: { id }, data: { outAt: now } });
    await releaseUnit(wo, id, now);
  }
  if (status === "DONE") {
    // A repair logged after the fact keeps its own dates, so it counts in the period the work was done.
    const out = wo.outAt ?? now;
    await db.workOrder.update({ where: { id }, data: { outAt: out, completedAt: wo.completedAt ?? out } });
    await releaseUnit(wo, id, now);
    if (wo.truck) {
      const data: { lastPmKm?: number; lastPmAt?: Date; nextServiceKm?: number; inspectionExpiry?: Date; odometerKm?: number } = {};
      // A reading taken in the shop is the newest one there is: it moves the truck's odometer forward, never back.
      if (wo.odometerKm != null && wo.odometerKm > wo.truck.odometerKm) data.odometerKm = wo.odometerKm;
      if (wo.category === "PM") {
        const odo = wo.odometerKm ?? wo.truck.odometerKm;
        // An older PM logged late must not wind the service schedule back.
        if (odo >= (wo.truck.lastPmKm ?? 0)) {
          data.lastPmKm = odo; data.lastPmAt = out; data.nextServiceKm = odo + (wo.truck.pmIntervalKm ?? 30000);
        }
      }
      if (wo.category === "INSPECTION") {
        const expiry = new Date(out.getTime() + 365 * 86_400_000);
        if (!wo.truck.inspectionExpiry || expiry > wo.truck.inspectionExpiry) data.inspectionExpiry = expiry;
      }
      if (Object.keys(data).length) await db.truck.update({ where: { id: wo.truck.id }, data });
    }
  }
  await audit(userId, "status", "work_order", id, `#${wo.number} ${wo.title} → ${status}`);
}

export async function saveWorkOrder(workOrderId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let id = workOrderId;
  const units: Unit[] = [];
  const res = await attempt(async () => {
    const f = fields(fd);
    const truckId = f.str("truckId");
    const trailerId = f.str("trailerId");
    if (!truckId && !trailerId) throw new FormError("Pick a truck or a trailer");
    const category = f.str("category") ?? "OTHER";
    const priority = f.str("priority") ?? "MEDIUM";
    const status = f.str("status") ?? "OPEN";
    if (!WORK_ORDER_CATEGORIES.includes(category as never)) throw new FormError("Pick a valid category");
    if (!WORK_ORDER_PRIORITIES.includes(priority as never)) throw new FormError("Pick a valid priority");
    if (!WORK_ORDER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const laborCost = f.num("laborCost") ?? 0;
    const partsCost = f.num("partsCost") ?? 0;
    const odometerKm = f.num("odometerKm");
    const data = {
      truckId: truckId ?? null, trailerId: truckId ? null : trailerId,
      title: f.req("title", "Title"),
      description: f.str("description"),
      category, priority, status,
      vendor: f.str("vendor"),
      scheduledAt: f.date("scheduledAt") ?? new Date(),
      inAt: f.date("inAt"), outAt: f.date("outAt"),
      odometerKm: odometerKm != null ? Math.round(odometerKm) : null,
      laborCost, partsCost, cost: f.num("cost") ?? laborCost + partsCost,
      notes: f.str("notes"),
    };
    const prev = workOrderId ? await db.workOrder.findUnique({ where: { id: workOrderId } }) : null;
    if (workOrderId && !prev) throw new FormError("This work order no longer exists.");
    const prevStatus = prev?.status ?? null;
    const unitChanged = Boolean(prev && (prev.truckId !== data.truckId || prev.trailerId !== data.trailerId));
    if (workOrderId) {
      await db.workOrder.update({ where: { id: workOrderId }, data });
      await audit(me.id, "update", "work_order", workOrderId, data.title);
    } else {
      const wo = await createWorkOrder({ ...data, createdById: me.id });
      id = wo.id;
      await audit(me.id, "create", "work_order", wo.id, `#${wo.number} ${data.title}`);
    }
    // A job in the shop that moves to another unit releases the old one (the new one goes in below).
    if (prev && prevStatus === "IN_PROGRESS" && unitChanged) await releaseUnit(prev, prev.id, new Date());
    if (prevStatus !== status || (status === "IN_PROGRESS" && unitChanged)) await applyWorkOrderSideEffects(id!, status, me.id, unitChanged ? null : prevStatus);
    units.push(data);
    if (prev && unitChanged) units.push(prev);
  });
  if (res?.error) return res;
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
  for (const u of units) revalidateUnit(u);
  redirect(`/maintenance/work-orders/${id}`);
}

/** Move a work order to `status`. Refusals throw FormError; the page wrappers turn them into ActionState. */
export async function setWorkOrderStatus(id: string, status: string) {
  const me = await requireUser("fleet.edit");
  if (!WORK_ORDER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
  const prev = await db.workOrder.findUnique({ where: { id }, select: { status: true, truckId: true, trailerId: true } });
  if (!prev) throw new FormError("This work order no longer exists.");
  await db.workOrder.update({ where: { id }, data: { status } });
  if (prev.status !== status) await applyWorkOrderSideEffects(id, status, me.id, prev.status);
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidateUnit(prev);
}

/** Quick "create" on the truck page's Maintenance tab: scheduled, started now, or logged as already done. */
export async function saveMaintenance(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const f = fields(fd);
    const truckId = f.req("truckId", "Truck");
    const raw = f.str("status") ?? "OPEN";
    const status = raw === "SCHEDULED" ? "OPEN" : raw;
    if (!["OPEN", "IN_PROGRESS", "DONE"].includes(status)) throw new FormError("Pick how the work order starts");
    const category = f.str("type") ?? f.str("category") ?? "OTHER";
    const scheduledAt = f.date("scheduledAt") ?? new Date();
    // Work logged as done on an earlier day is dated that day, so its cost lands in the right month.
    const doneEarlier = status === "DONE" && scheduledAt < startOfDay(new Date());
    const odometerKm = f.num("odometerKm");
    const cost = f.num("cost") ?? 0;
    if (cost < 0) throw new FormError("The cost can't be negative");
    const wo = await createWorkOrder({
      truckId,
      title: f.req("description", "What needs doing"),
      category: WORK_ORDER_CATEGORIES.includes(category as never) ? category : "OTHER",
      status, scheduledAt,
      ...(doneEarlier ? { outAt: scheduledAt, completedAt: scheduledAt } : {}),
      cost, vendor: f.str("vendor"), odometerKm: odometerKm != null ? Math.round(odometerKm) : null, createdById: me.id,
    });
    await audit(me.id, "create", "work_order", wo.id, `#${wo.number} ${wo.title}`);
    if (status === "IN_PROGRESS" || status === "DONE") await applyWorkOrderSideEffects(wo.id, status, me.id, null);
    revalidatePath("/maintenance");
    revalidatePath("/maintenance/work-orders");
    revalidateUnit({ truckId, trailerId: null });
    return { ok: `Work order #${wo.number} created` };
  });
}

/* ------------------------------------------------------------------ */
/* Fuel                                                                */
/* ------------------------------------------------------------------ */

/** "Log fuel" on the truck page. A reading above the truck's odometer moves the odometer forward. */
export async function addFuelLog(truckId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const f = fields(fd);
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, odometerKm: true, driverId: true } });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    const liters = f.num("liters");
    const cost = f.num("cost");
    if (!liters || !cost || liters <= 0 || cost <= 0) throw new FormError("Enter the litres and the cost (both above zero)");
    const rawOdometer = f.num("odometerKm");
    const odometerKm = rawOdometer != null ? Math.round(rawOdometer) : null;
    if (odometerKm != null && odometerKm < 0) throw new FormError("The odometer can't be negative");
    // Today's fill is stamped now; an earlier day keeps that day, so the fill counts in the right month.
    const day = f.str("date");
    const picked = !day || day === toDateInput(new Date()) ? new Date() : f.date("date")!;
    // Up to a day ahead is "today" in a time zone ahead of the server's; further is a typo.
    if (picked.getTime() > Date.now() + 86_400_000) throw new FormError("The fill date is in the future");
    const date = picked.getTime() > Date.now() ? new Date() : picked;
    await db.fuelLog.create({ data: { truckId, driverId: truck.driverId, liters, cost, odometerKm, station: f.str("station"), date } });
    const raised = odometerKm != null && odometerKm > truck.odometerKm;
    if (raised) await db.truck.update({ where: { id: truckId }, data: { odometerKm } });
    await audit(me.id, "fuel", "truck", truckId, `${truck.unitNumber}: ${liters} L`);
    revalidatePath(`/fleet/${truckId}`);
    revalidatePath("/fleet");
    if (raised) revalidatePath("/maintenance");
    return { ok: raised ? `Fuel logged. Odometer moved to ${number(odometerKm)} km.` : "Fuel logged" };
  });
}
