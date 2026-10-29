"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { OWNERSHIP, TRUCK_STATUSES } from "@/lib/constants";
import { getFormat } from "@/lib/format-server";
import { dayKey, parseDateInput, startOfDayIn } from "@/lib/locale";
import { setTruckDriver } from "@/lib/assignments";
import { serviceStatus } from "@/lib/service";
import { ODOMETER_JUMP_KM, placeFromText } from "@/app/(app)/fleet/lib";

/*
 * Truck actions: the truck form, the one-click fixes on the truck page, notes, readings and fuel.
 * Truck status changes and trailers live in src/app/(app)/fleet/actions.ts; repair orders in src/app/actions/repairs.ts.
 * Distances and volumes are in the company's own units (src/lib/locale.ts); messages label them with the formatter.
 * Saving an odometer stamps `odometerAt`, so the service countdown knows how fresh its number is.
 */

/** Every page that shows a truck's odometer, service or paperwork. */
function refreshTruck(truckId: string | null) {
  revalidatePath("/fleet");
  if (truckId) revalidatePath(`/fleet/${truckId}`);
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/oil");
  revalidatePath("/dashboard");
}

/* ------------------------------------------------------------------ */
/* Truck form                                                          */
/* ------------------------------------------------------------------ */

/** Add / edit truck form. Saving opens the truck page. */
export async function saveTruck(truckId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  let id = truckId;
  const res = await attempt(async () => {
    const f = fields(fd, me.company.timezone);
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
    const truckTypeId = f.str("truckTypeId");
    if (truckTypeId && !(await db.truckType.count({ where: { id: truckTypeId } }))) {
      throw new FormError("That truck type no longer exists. Reload the page and pick again.");
    }
    const odometerKm = f.num("odometerKm") ?? 0;
    if (odometerKm < 0) throw new FormError("The odometer can't be negative");
    const engineHours = f.num("engineHours");
    if (engineHours != null && engineHours < 0) throw new FormError("Engine hours can't be negative");
    const pmIntervalKm = f.num("pmIntervalKm") ?? (fmt.imperial ? 15000 : 30000);
    if (pmIntervalKm <= 0) throw new FormError("The oil interval must be above zero");
    const leased = ownership === "LEASED";
    const data = {
      unitNumber,
      make: f.req("make", "Make"),
      model: f.req("model", "Model"),
      year: f.num("year") ?? new Date().getFullYear(),
      vin: f.str("vin")?.toUpperCase() ?? null,
      plate: f.req("plate", "Plate"),
      status,
      ownership,
      group: f.str("group"),
      homeTerminal: f.str("homeTerminal"),
      color: f.str("color"),
      inServiceAt: f.date("inServiceAt"),
      truckTypeId,
      engineHours: engineHours != null ? Math.round(engineHours) : null,
      lessor: leased ? f.str("lessor") : null,
      leaseStartKm: leased ? f.num("leaseStartKm") : null,
      leaseAnnualLimitKm: leased ? f.num("leaseAnnualLimitKm") : null,
      leaseBufferPct: leased ? f.num("leaseBufferPct") : null,
      leaseOverageRate: leased ? f.num("leaseOverageRate") : null,
      odometerKm: Math.round(odometerKm),
      pmIntervalKm: Math.round(pmIntervalKm),
      lastPmKm: f.num("lastPmKm"),
      lastPmAt: f.date("lastPmAt"),
      nextServiceKm: f.num("nextServiceKm"),
      fuelType: f.str("fuelType") ?? "DIESEL",
      fuelCapacityL: f.num("fuelCapacityL") ?? (fmt.imperial ? 150 : 600),
      insuranceExpiry: f.date("insuranceExpiry"),
      inspectionExpiry: f.date("inspectionExpiry"),
      registrationExpiry: f.date("registrationExpiry"),
      notes: f.str("notes"),
    };
    let driverBefore: string | null = null;
    if (truckId) {
      const before = await db.truck.findUnique({ where: { id: truckId }, select: { odometerKm: true, driverId: true } });
      if (!before) throw new FormError("This truck no longer exists.");
      driverBefore = before.driverId;
      const read = before.odometerKm !== data.odometerKm;
      await db.truck.update({ where: { id: truckId }, data: { ...data, ...(read ? { odometerAt: new Date() } : {}) } });
      await audit(me.id, "update", "truck", truckId, data.unitNumber);
      // Logged like a saved reading, so the truck's history shows where the number came from.
      if (read) await audit(me.id, "readings", "truck", truckId, `odometer ${fmt.dist(data.odometerKm)} (edited)`);
    } else {
      // A new truck has no position until someone enters where it is (or a tracker reports one).
      const place = f.str("locationName");
      const where = place ? { ...placeFromText(place), pingSource: "MANUAL", lastPingAt: new Date() } : {};
      const t = await db.truck.create({ data: { ...data, ...where, ...(data.odometerKm > 0 ? { odometerAt: new Date() } : {}) } });
      id = t.id;
      await audit(me.id, "create", "truck", t.id, data.unitNumber);
    }
    // The driver picked on the form starts (or ends) a stint today, so the truck's driver history stays whole.
    if (id && driverId !== driverBefore) {
      await setTruckDriver({ truckId: id, driverId, day: startOfDayIn(new Date(), me.company.timezone), userId: me.id });
      await audit(me.id, driverId ? "assign driver" : "unassign driver", "truck", id, driverId ? `from ${fmt.date(new Date())} (truck form)` : "driver taken off (truck form)");
    }
  });
  if (res?.error) return res;
  refreshTruck(id);
  redirect(`/fleet/${id}`);
}

/* ------------------------------------------------------------------ */
/* One-click fixes on the truck page                                   */
/* ------------------------------------------------------------------ */

const COMPLETE_FIELDS = ["plate", "inServiceAt", "truckTypeId"] as const;
type CompleteField = (typeof COMPLETE_FIELDS)[number];

/**
 * The "finish this truck's record" prompts: add the plate, the in-service date or the truck type in one step, without
 * opening the whole form. The value comes in the `value` field.
 */
export async function completeTruck(truckId: string, field: CompleteField, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!COMPLETE_FIELDS.includes(field)) throw new FormError("That can't be set from here. Use Edit.");
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true } });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    const f = fields(fd, me.company.timezone);
    let data: Prisma.TruckUncheckedUpdateInput;
    let done: string;
    if (field === "plate") {
      const plate = f.req("value", "Plate").toUpperCase();
      data = { plate };
      done = `Plate ${plate} saved`;
    } else if (field === "inServiceAt") {
      const at = f.date("value");
      if (!at) throw new FormError("Pick the date the truck went into service");
      if (at.getTime() > Date.now() + 86_400_000) throw new FormError("The in-service date is in the future");
      data = { inServiceAt: at };
      done = "In-service date saved";
    } else {
      const typeId = f.req("value", "Truck type");
      const type = await db.truckType.findUnique({ where: { id: typeId }, select: { name: true } });
      if (!type) throw new FormError("That truck type no longer exists. Refresh the page.");
      data = { truckTypeId: typeId };
      done = `${truck.unitNumber} is now a ${type.name}: the oil interval comes from that type`;
    }
    await db.truck.update({ where: { id: truckId }, data });
    await audit(me.id, "update", "truck", truckId, `${truck.unitNumber}: ${field}`);
    refreshTruck(truckId);
    return { ok: done };
  });
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export async function addTruckNote(truckId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const note = fields(fd).req("note", "Note");
    const t = await db.truck.findUnique({ where: { id: truckId }, select: { notes: true } });
    if (!t) throw new FormError("This truck no longer exists. Refresh the page.");
    // The day is the company's, so a note written late in the evening isn't dated tomorrow.
    const stamp = `${dayKey(new Date(), me.company.timezone)} ${me.name}: ${note.replace(/\s*\n\s*/g, " ")}`;
    await db.truck.update({ where: { id: truckId }, data: { notes: t.notes ? `${stamp}\n${t.notes}` : stamp } });
    await audit(me.id, "note", "truck", truckId, note);
    revalidatePath(`/fleet/${truckId}`);
    return { ok: "Note added" };
  });
}

/* ------------------------------------------------------------------ */
/* Readings                                                            */
/* ------------------------------------------------------------------ */

/**
 * "Update readings" on the truck page: odometer, fuel level and where the truck is. Without telematics this is what
 * keeps the service countdown, the lease cap and the map honest. The odometer never goes backwards (or jumps by an
 * implausible amount) unless the person ticks "I've checked this reading". Re-entering the same odometer confirms it:
 * the reading is dated now.
 */
export async function updateTruckReadings(truckId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  return attempt(async () => {
    const f = fields(fd, me.company.timezone);
    const truck = await db.truck.findUnique({
      where: { id: truckId },
      select: {
        unitNumber: true, odometerKm: true, odometerAt: true, pmIntervalKm: true, lastPmKm: true, lastPmAt: true, nextServiceKm: true,
        truckType: { select: { name: true, oilIntervalKm: true } },
      },
    });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    const rawOdometer = f.num("odometerKm");
    const fuelPct = f.num("fuelPct");
    const place = f.str("locationName");
    const checked = f.bool("confirm");
    if (rawOdometer == null && fuelPct == null && !place) throw new FormError("Enter an odometer reading, a fuel level or a location");

    const now = new Date();
    const data: Prisma.TruckUncheckedUpdateInput = {};
    const saved: string[] = [];
    let odometer: number | null = null;
    if (rawOdometer != null) {
      odometer = Math.round(rawOdometer);
      if (odometer < 0) throw new FormError("The odometer can't be negative");
      if (odometer < truck.odometerKm && !checked) {
        throw new FormError(`${truck.unitNumber} already reads ${fmt.dist(truck.odometerKm)}, so ${fmt.dist(odometer)} would wind it back. Check the reading, or tick "I've checked this reading" to correct it.`);
      }
      if (odometer - truck.odometerKm > ODOMETER_JUMP_KM && !checked) {
        throw new FormError(`That is ${fmt.dist(odometer - truck.odometerKm)} more than the last reading (${fmt.dist(truck.odometerKm)}). Check for an extra digit, or tick "I've checked this reading" to save it.`);
      }
      data.odometerKm = odometer;
      data.odometerAt = now;
      saved.push(odometer === truck.odometerKm ? `odometer ${fmt.dist(odometer)} confirmed` : `odometer ${fmt.dist(odometer)}`);
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
      Object.assign(data, { ...p, speedKmh: null, engineOn: null, pingSource: "MANUAL", lastPingAt: now });
      saved.push(`location ${p.locationName}`);
    }

    await db.truck.update({ where: { id: truckId }, data });
    await audit(me.id, "readings", "truck", truckId, saved.join(", "));
    refreshTruck(truckId);
    revalidatePath("/tracking");

    const parts = [`Saved ${saved.join(", ")}.`];
    if (odometer != null) {
      const s = serviceStatus({ ...truck, odometerKm: odometer, odometerAt: now });
      if (s.state === "overdue") parts.push(`Oil service is overdue by ${fmt.dist(-(s.left ?? 0))}.`);
      else if (s.state === "due_now" || s.state === "due_soon") parts.push(`Oil service is due in ${fmt.dist(s.left)}.`);
    }
    if (offMap) parts.push("No known city in the location, so it is kept as text and not shown on the map.");
    return { ok: parts.join(" ") };
  });
}

/* ------------------------------------------------------------------ */
/* Fuel                                                                */
/* ------------------------------------------------------------------ */

/** "Log fuel" on the truck page. A reading above the truck's odometer moves the odometer forward (dated by the fill). */
export async function addFuelLog(truckId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  return attempt(async () => {
    const f = fields(fd, me.company.timezone);
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, odometerKm: true, odometerAt: true, driverId: true } });
    if (!truck) throw new FormError("This truck no longer exists. Refresh the page.");
    const liters = f.num("liters");
    const cost = f.num("cost");
    if (!liters || !cost || liters <= 0 || cost <= 0) throw new FormError(`Enter the ${fmt.labels.volumeLong} and the cost (both above zero)`);
    const rawOdometer = f.num("odometerKm");
    const odometerKm = rawOdometer != null ? Math.round(rawOdometer) : null;
    if (odometerKm != null && odometerKm < 0) throw new FormError("The odometer can't be negative");
    // Today's fill (company time) is stamped now; an earlier day keeps that day, so the fill counts in the right month.
    const now = new Date();
    const day = f.str("date");
    const picked = !day || day === dayKey(now, me.company.timezone) ? now : parseDateInput(day, me.company.timezone);
    if (!picked) throw new FormError("Pick the fill date");
    if (picked.getTime() > now.getTime()) throw new FormError("The fill date is in the future");
    await db.fuelLog.create({ data: { truckId, driverId: truck.driverId, liters, cost, odometerKm, station: f.str("station"), date: picked } });
    const raised = odometerKm != null && odometerKm > truck.odometerKm;
    if (raised) await db.truck.update({ where: { id: truckId }, data: { odometerKm, odometerAt: truck.odometerAt && truck.odometerAt > picked ? truck.odometerAt : picked } });
    await audit(me.id, "fuel", "truck", truckId, `${truck.unitNumber}: ${fmt.vol(liters)}`);
    revalidatePath(`/fleet/${truckId}`);
    revalidatePath("/fleet");
    if (raised) refreshTruck(truckId);
    return { ok: raised ? `Fuel logged. Odometer moved to ${fmt.dist(odometerKm)}.` : "Fuel logged" };
  });
}
