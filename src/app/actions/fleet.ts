"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from "@/lib/constants";
import { notifyMaintenance } from "@/lib/notify";

/* ------------------------------------------------------------------ */
/* Trucks                                                              */
/* ------------------------------------------------------------------ */

export async function saveTruck(truckId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let id = truckId;
  const res = await attempt(async () => {
    const f = fields(fd);
    const driverId = f.str("driverId");
    if (driverId) {
      const other = await db.truck.findFirst({ where: { driverId, id: truckId ? { not: truckId } : undefined } });
      if (other) throw new FormError(`That driver is already assigned to ${other.unitNumber}`);
    }
    const ownership = f.str("ownership") ?? "COMPANY";
    const data = {
      unitNumber: f.req("unitNumber", "Unit number"),
      make: f.req("make", "Make"),
      model: f.req("model", "Model"),
      year: f.num("year") ?? new Date().getFullYear(),
      vin: f.str("vin"),
      plate: f.req("plate", "Plate"),
      status: f.str("status") ?? "ACTIVE",
      ownership,
      group: f.str("group"),
      lessor: ownership === "LEASED" ? f.str("lessor") : null,
      leaseStartKm: ownership === "LEASED" ? f.num("leaseStartKm") : null,
      leaseAnnualLimitKm: ownership === "LEASED" ? f.num("leaseAnnualLimitKm") : null,
      leaseBufferPct: ownership === "LEASED" ? f.num("leaseBufferPct") : null,
      leaseOverageRate: ownership === "LEASED" ? f.num("leaseOverageRate") : null,
      odometerKm: f.num("odometerKm") ?? 0,
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
      await db.truck.update({ where: { id: truckId }, data });
      await audit(me.id, "update", "truck", truckId, data.unitNumber);
    } else {
      const t = await db.truck.create({ data: { ...data, lat: 41.2995, lng: 69.2401, locationName: "Tashkent" } });
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
    const t = await db.truck.findUniqueOrThrow({ where: { id: truckId } });
    const stamp = `${new Date().toISOString().slice(0, 10)} ${me.name}: ${note}`;
    await db.truck.update({ where: { id: truckId }, data: { notes: t.notes ? `${stamp}\n${t.notes}` : stamp } });
    await audit(me.id, "note", "truck", truckId, note);
    revalidatePath(`/fleet/${truckId}`);
    return { ok: "Note added" };
  });
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

type Unit = { truckId: string | null; trailerId: string | null };

/** Work only starts on a free unit: a truck or trailer on a dispatched or in-transit load is recovered first. */
async function assertUnitOffLoad(unit: Unit) {
  const where = unit.truckId ? { truckId: unit.truckId } : unit.trailerId ? { trailerId: unit.trailerId } : null;
  if (!where) return;
  const load = await db.load.findFirst({
    where: { ...where, status: { in: ["ASSIGNED", "IN_TRANSIT"] } },
    orderBy: { pickupAt: "asc" },
    select: { reference: true, truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } },
  });
  if (!load) return;
  const unitNumber = (unit.truckId ? load.truck?.unitNumber : load.trailer?.unitNumber) ?? "The unit";
  throw new FormError(`${unitNumber} is on ${load.reference}. Recover the load to another unit before starting this job.`);
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
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id }, include: { truck: true, trailer: true } });
  const now = new Date();
  if (status === "IN_PROGRESS") {
    await db.workOrder.update({ where: { id }, data: { inAt: wo.inAt ?? now } });
    if (wo.truckId) await db.truck.update({ where: { id: wo.truckId }, data: { status: "MAINTENANCE" } });
    if (wo.trailerId) await db.trailer.update({ where: { id: wo.trailerId }, data: { status: "SHOP", statusSince: now, truckId: null } });
    after(() => notifyMaintenance(id, status));
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
      const data: { lastPmKm?: number; lastPmAt?: Date; nextServiceKm?: number; inspectionExpiry?: Date } = {};
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
    after(() => notifyMaintenance(id, status));
  }
  await audit(userId, "status", "work_order", id, `#${wo.number} ${wo.title} → ${status}`);
}

export async function saveWorkOrder(workOrderId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let id = workOrderId;
  const res = await attempt(async () => {
    const f = fields(fd);
    const truckId = f.str("truckId");
    const trailerId = f.str("trailerId");
    if (!truckId && !trailerId) throw new FormError("Pick a truck or a trailer");
    const category = f.str("category") ?? "OTHER";
    const priority = f.str("priority") ?? "MEDIUM";
    const status = f.str("status") ?? "OPEN";
    if (!WORK_ORDER_CATEGORIES.includes(category as never)) throw new FormError("Invalid category");
    if (!WORK_ORDER_PRIORITIES.includes(priority as never)) throw new FormError("Invalid priority");
    if (!WORK_ORDER_STATUSES.includes(status as never)) throw new FormError("Invalid status");
    const laborCost = f.num("laborCost") ?? 0;
    const partsCost = f.num("partsCost") ?? 0;
    const data = {
      truckId: truckId ?? null, trailerId: truckId ? null : trailerId,
      title: f.req("title", "Title"),
      description: f.str("description"),
      category, priority, status,
      vendor: f.str("vendor"),
      scheduledAt: f.date("scheduledAt") ?? new Date(),
      inAt: f.date("inAt"), outAt: f.date("outAt"),
      odometerKm: f.num("odometerKm"),
      laborCost, partsCost, cost: f.num("cost") ?? laborCost + partsCost,
      notes: f.str("notes"),
    };
    const prev = workOrderId ? await db.workOrder.findUniqueOrThrow({ where: { id: workOrderId } }) : null;
    const prevStatus = prev?.status ?? null;
    const unitChanged = Boolean(prev && (prev.truckId !== data.truckId || prev.trailerId !== data.trailerId));
    if (status === "IN_PROGRESS" && (prevStatus !== "IN_PROGRESS" || unitChanged)) await assertUnitOffLoad(data);
    if (workOrderId) {
      await db.workOrder.update({ where: { id: workOrderId }, data });
      await audit(me.id, "update", "work_order", workOrderId, data.title);
    } else {
      const wo = await db.workOrder.create({ data: { ...data, createdById: me.id } });
      id = wo.id;
      await audit(me.id, "create", "work_order", wo.id, `#${wo.number} ${data.title}`);
    }
    // A job in the shop that moves to another unit releases the old one (the new one goes in below).
    if (prev && prevStatus === "IN_PROGRESS" && unitChanged) await releaseUnit(prev, prev.id, new Date());
    if (prevStatus !== status || (status === "IN_PROGRESS" && unitChanged)) await applyWorkOrderSideEffects(id!, status, me.id, unitChanged ? null : prevStatus);
  });
  if (res?.error) return res;
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
  redirect(`/maintenance/work-orders/${id}`);
}

/** Move a work order to `status`. Refusals throw FormError; the page wrappers turn them into ActionState. */
export async function setWorkOrderStatus(id: string, status: string) {
  const me = await requireUser("fleet.edit");
  if (!WORK_ORDER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
  const prev = await db.workOrder.findUnique({ where: { id }, select: { status: true, truckId: true, trailerId: true } });
  if (!prev) throw new FormError("This work order no longer exists.");
  if (status === "IN_PROGRESS" && prev.status !== "IN_PROGRESS") await assertUnitOffLoad(prev);
  await db.workOrder.update({ where: { id }, data: { status } });
  if (prev.status !== status) await applyWorkOrderSideEffects(id, status, me.id, prev.status);
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id } });
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
  revalidatePath(`/maintenance/work-orders/${id}`);
  if (wo.truckId) revalidatePath(`/fleet/${wo.truckId}`);
}

/** Quick "create and start" from a truck page (the old maintenance form). */
export async function saveMaintenance(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const f = fields(fd);
    const truckId = f.req("truckId", "Truck");
    const status = f.str("status") ?? "OPEN";
    const category = f.str("type") ?? f.str("category") ?? "OTHER";
    if (status === "IN_PROGRESS") await assertUnitOffLoad({ truckId, trailerId: null });
    const wo = await db.workOrder.create({
      data: {
        truckId, title: f.req("description", "Description"), category: WORK_ORDER_CATEGORIES.includes(category as never) ? category : "OTHER",
        status: status === "SCHEDULED" ? "OPEN" : status, scheduledAt: f.date("scheduledAt") ?? new Date(),
        cost: f.num("cost") ?? 0, vendor: f.str("vendor"), odometerKm: f.num("odometerKm"), createdById: me.id,
      },
    });
    if (["IN_PROGRESS", "DONE"].includes(wo.status)) await applyWorkOrderSideEffects(wo.id, wo.status, me.id, null);
    revalidatePath("/maintenance");
    revalidatePath(`/fleet/${truckId}`);
    return { ok: `Work order #${wo.number} created` };
  });
}


/* ------------------------------------------------------------------ */
/* Fuel                                                                */
/* ------------------------------------------------------------------ */

export async function addFuelLog(truckId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  return attempt(async () => {
    const f = fields(fd);
    const truck = await db.truck.findUniqueOrThrow({ where: { id: truckId } });
    if (me.role === "DRIVER" && truck.driverId !== me.driver?.id) throw new FormError("Not your truck");
    if (me.role !== "DRIVER" && !["OWNER", "ADMIN", "FLEET_MANAGER"].includes(me.role)) throw new FormError("Not allowed");
    const liters = f.num("liters");
    const cost = f.num("cost");
    if (!liters || !cost || liters <= 0 || cost <= 0) throw new FormError("Enter the litres and the cost (both above zero)");
    const odometerKm = f.num("odometerKm");
    await db.fuelLog.create({ data: { truckId, driverId: truck.driverId, liters, cost, odometerKm, station: f.str("station") } });
    if (odometerKm && odometerKm > truck.odometerKm) await db.truck.update({ where: { id: truckId }, data: { odometerKm, fuelPct: 95 } });
    revalidatePath(`/fleet/${truckId}`);
    revalidatePath("/driver");
    return { ok: "Fuel logged" };
  });
}
