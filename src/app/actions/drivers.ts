"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { DRIVER_STATUSES, DRIVER_TYPES } from "@/lib/constants";

/* ------------------------------------------------------------------ */
/* Driver actions. Truck assignment writes Truck.driverId (a truck has  */
/* at most one driver and a driver at most one truck).                  */
/* ------------------------------------------------------------------ */

const EMPLOYMENT: Record<string, string> = { ACTIVE: "active", ON_LEAVE: "on leave", INACTIVE: "inactive" };

/** Every page that shows drivers or who drives a truck. */
function refresh(driverId?: string | null, fleet = false) {
  revalidatePath("/drivers");
  if (driverId) revalidatePath(`/drivers/${driverId}`);
  revalidatePath("/dashboard");
  if (fleet) {
    revalidatePath("/fleet", "layout");
    revalidatePath("/tracking");
  }
}

/**
 * The truck `truckId` may be given to `driverId` (null = a driver being created): it exists, is not retired, and has
 * no other driver. Throws a FormError that says how to fix it otherwise.
 */
async function checkTruck(truckId: string, driverId: string | null) {
  const truck = await db.truck.findUnique({
    where: { id: truckId },
    select: { id: true, unitNumber: true, status: true, driverId: true, driver: { select: { name: true } } },
  });
  if (!truck) throw new FormError("That truck no longer exists. Pick another one.");
  if (truck.driverId && truck.driverId !== driverId) {
    throw new FormError(`${truck.unitNumber} already has a driver (${truck.driver?.name ?? "someone else"}). Unassign it from them first.`);
  }
  if (truck.status === "INACTIVE" && truck.driverId !== driverId) {
    throw new FormError(`${truck.unitNumber} is inactive. Reactivate it in Fleet before giving it a driver.`);
  }
  return truck;
}

/** Point `driverId` at `truckId` (or at no truck). Returns the units that changed, for messages and the audit log. */
async function linkTruck(driverId: string, truckId: string | null) {
  const current = await db.truck.findFirst({ where: { driverId }, select: { id: true, unitNumber: true } });
  if ((current?.id ?? null) === truckId) return { changed: false, from: current, to: current };
  // One truck per driver: free the old one before the new one takes the driver (Truck.driverId is unique).
  if (current) await db.truck.update({ where: { id: current.id }, data: { driverId: null } });
  let to: { id: string; unitNumber: string } | null = null;
  if (truckId) to = await db.truck.update({ where: { id: truckId }, data: { driverId }, select: { id: true, unitNumber: true } });
  return { changed: true, from: current, to };
}

function auditTruckChange(me: CurrentUser, driverId: string, name: string, from: { unitNumber: string } | null, to: { unitNumber: string } | null) {
  return to
    ? audit(me.id, "assign truck", "driver", driverId, `${name} → ${to.unitNumber}${from ? ` (was ${from.unitNumber})` : ""}`)
    : audit(me.id, "unassign truck", "driver", driverId, `${name} no longer drives ${from?.unitNumber ?? "a truck"}`);
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create (`driverId` null) or update a driver from the driver form, then open the driver page.
 * A `truckId` field (present only for people who may edit the fleet) also sets the assigned truck; "" = no truck.
 */
export async function saveDriver(driverId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("drivers.edit");
  let id = driverId;
  let fleetChanged = false;
  const res = await attempt(async () => {
    const f = fields(fd);
    const licenseExpiry = f.date("licenseExpiry");
    if (!licenseExpiry) throw new FormError("Licence expiry is required");
    const status = f.str("status") ?? "ACTIVE";
    const type = f.str("type") ?? "COMPANY";
    if (!DRIVER_STATUSES.includes(status as never)) throw new FormError("Pick an employment status");
    if (!DRIVER_TYPES.includes(type as never)) throw new FormError("Pick a driver type");
    const scoreIn = f.num("score");
    if (scoreIn != null && (scoreIn < 0 || scoreIn > 100)) throw new FormError("Safety score must be between 0 and 100");
    const hold = f.bool("hold");
    const data = {
      name: f.req("name", "Full name"),
      phone: f.str("phone"),
      phone2: f.str("phone2"),
      email: f.str("email")?.toLowerCase() ?? null,
      licenseNumber: f.req("licenseNumber", "Licence number"),
      licenseClass: f.str("licenseClass") ?? "CE",
      licenseExpiry,
      medicalExpiry: f.date("medicalExpiry"),
      hireDate: f.date("hireDate") ?? new Date(),
      status,
      type,
      ...(scoreIn != null ? { score: Math.round(scoreIn) } : {}),
      hold,
      holdReason: hold ? f.str("holdReason") : null,
      notes: f.str("notes"),
    };

    // Truck: only when the form offered the picker and the person may change the fleet.
    const pickTruck = fd.has("truckId") && can(me.role, "fleet.edit");
    // Leaving the company (inactive) always frees their truck, whatever the picker says.
    const truckId = status === "INACTIVE" ? null : pickTruck ? f.str("truckId") : undefined;
    // Check the truck before writing anything, so a refusal never leaves a half-saved driver behind.
    if (truckId) await checkTruck(truckId, driverId);

    if (driverId) {
      await db.driver.update({ where: { id: driverId }, data });
      await audit(me.id, "update", "driver", driverId, data.name);
    } else {
      const d = await db.driver.create({ data });
      id = d.id;
      await audit(me.id, "create", "driver", d.id, data.name);
    }
    if (truckId !== undefined && id) {
      const link = await linkTruck(id, truckId);
      if (link.changed) {
        fleetChanged = true;
        await auditTruckChange(me, id, data.name, link.from, link.to);
      }
    }
  });
  if (res?.error) return res;
  refresh(id, fleetChanged);
  redirect(`/drivers/${id}`);
}

/* ------------------------------------------------------------------ */
/* Inline controls on the driver page                                  */
/* ------------------------------------------------------------------ */

/** Place a driver on hold (not cleared to drive, with an optional reason) or release them. */
export async function setDriverHold(driverId: string, hold: boolean, reason?: string | null): Promise<ActionState> {
  const me = await requireUser("drivers.edit");
  const res = await attempt(async () => {
    const prev = await db.driver.findUnique({ where: { id: driverId }, select: { name: true } });
    if (!prev) throw new FormError("This driver no longer exists.");
    const why = hold ? reason?.trim() || null : null;
    await db.driver.update({ where: { id: driverId }, data: { hold, holdReason: why } });
    await audit(me.id, hold ? "hold" : "release", "driver", driverId, `${prev.name}${why ? `: ${why}` : ""}`);
    return { ok: hold ? `${prev.name} is on hold` : `${prev.name} is released` };
  });
  refresh(driverId);
  return res;
}

/**
 * Employment status from the driver page. Marking a driver inactive (no longer works here) also frees their truck.
 * Refusals come back as { error } (a thrown message is hidden in production).
 */
export async function setDriverEmployment(driverId: string, status: string): Promise<ActionState> {
  const me = await requireUser("drivers.edit");
  let fleetChanged = false;
  const res = await attempt(async () => {
    if (!DRIVER_STATUSES.includes(status as never)) throw new FormError("Pick a valid status");
    const prev = await db.driver.findUnique({ where: { id: driverId }, select: { name: true, status: true } });
    if (!prev) throw new FormError("This driver no longer exists.");
    if (prev.status === status) return { ok: "No change" };
    await db.driver.update({ where: { id: driverId }, data: { status } });
    await audit(me.id, "status", "driver", driverId, `${prev.name}: ${EMPLOYMENT[prev.status] ?? prev.status} → ${EMPLOYMENT[status]}`);
    if (status === "INACTIVE") {
      const link = await linkTruck(driverId, null);
      if (link.changed) {
        fleetChanged = true;
        await auditTruckChange(me, driverId, prev.name, link.from, null);
        return { ok: `${prev.name} is inactive. ${link.from?.unitNumber} no longer has a driver.` };
      }
    }
    return { ok: `${prev.name} is ${EMPLOYMENT[status]}` };
  });
  refresh(driverId, fleetChanged);
  return res;
}

/**
 * Give `driverId` the truck `truckId`, or take their truck away (null). One driver per truck: a truck that already has
 * another driver is refused (unassign it there first); the driver's previous truck is freed.
 */
export async function assignTruck(driverId: string, truckId: string | null): Promise<ActionState> {
  const me = await requireUser("drivers.edit");
  if (!can(me.role, "fleet.edit")) return { error: "You can't change truck assignments in this company." };
  let changed = false;
  const res = await attempt(async () => {
    const driver = await db.driver.findUnique({ where: { id: driverId }, select: { name: true, status: true } });
    if (!driver) throw new FormError("This driver no longer exists.");
    if (truckId) {
      if (driver.status === "INACTIVE") throw new FormError(`${driver.name} is inactive. Set them back to active before giving them a truck.`);
      await checkTruck(truckId, driverId);
    }
    const link = await linkTruck(driverId, truckId || null);
    if (!link.changed) return { ok: "No change" };
    changed = true;
    await auditTruckChange(me, driverId, driver.name, link.from, link.to);
    return { ok: link.to ? `${driver.name} now drives ${link.to.unitNumber}` : `${link.from?.unitNumber} no longer has a driver` };
  });
  if (changed) refresh(driverId, true);
  return res;
}
