"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { PAYMENT_STATUSES } from "@/lib/constants";
import { makeFormat, normalizeLocale } from "@/lib/locale";
import { roLabel } from "@/lib/service";
import {
  applyWorkOrderSideEffects, costOf, createWorkOrder, logEvent, readLines, replaceLines, revalidateRepair, stampedDate, vendorFromForm,
} from "@/lib/work-orders";
import { OIL_CHECKLIST, OIL_SERVICE_TYPES } from "@/components/shop/shared";

/*
 * Oil & PM: truck types (each with its oil interval, in the company's distance unit), booking an oil change, and
 * logging one that was done — which writes ONE completed repair order and restarts the interval.
 */

/** Sanity bounds for an oil interval, in the company's own unit. */
const MIN_INTERVAL = 1000;
const MAX_INTERVAL = 150_000;
/** A reading this far above the truck's last one is probably a typo (an extra digit). */
const MAX_JUMP = 50_000;

function refreshOil() {
  revalidatePath("/maintenance/oil");
  revalidatePath("/fleet");
  revalidatePath("/dashboard");
}

/* ------------------------------------------------------------------ */
/* Truck types                                                         */
/* ------------------------------------------------------------------ */

export async function saveTruckType(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const f = fields(fd);
    const name = f.req("name", "Type name").slice(0, 60);
    const interval = f.num("oilIntervalKm");
    if (interval == null) throw new FormError("Enter the oil change interval");
    if (interval < MIN_INTERVAL || interval > MAX_INTERVAL) {
      const fmt = makeFormat(normalizeLocale(me.company));
      throw new FormError(`The interval should be between ${fmt.dist(MIN_INTERVAL)} and ${fmt.dist(MAX_INTERVAL)}`);
    }
    const clash = await db.truckType.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (clash) throw new FormError(`There is already a type called ${name}`);
    const data = { name, oilIntervalKm: Math.round(interval) };
    if (id) {
      const found = await db.truckType.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new FormError("This truck type no longer exists. Reload the page.");
      await db.truckType.update({ where: { id }, data });
    } else {
      await db.truckType.create({ data });
    }
    await audit(me.id, id ? "update" : "create", "truck_type", id, `${name} · ${data.oilIntervalKm}`);
    refreshOil();
    return { ok: id ? `${name} saved` : `${name} added` };
  });
}

/** Trucks of a deleted type fall back to their own interval. */
export async function deleteTruckType(id: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const t = await db.truckType.findUnique({ where: { id }, select: { name: true, _count: { select: { trucks: true } } } });
    if (!t) throw new FormError("This truck type no longer exists. Reload the page.");
    await db.truck.updateMany({ where: { truckTypeId: id }, data: { truckTypeId: null } });
    await db.truckType.delete({ where: { id } });
    await audit(me.id, "delete", "truck_type", id, t.name);
    refreshOil();
    return { ok: t._count.trucks ? `${t.name} deleted. Its trucks use their own interval now.` : `${t.name} deleted` };
  });
}

/** Quick "set type" on the oil board (the truck form has the same field). */
export async function setTruckType(truckId: string, truckTypeId: string | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true } });
    if (!truck) throw new FormError("This truck no longer exists. Reload the page.");
    const type = truckTypeId ? await db.truckType.findUnique({ where: { id: truckTypeId }, select: { name: true } }) : null;
    if (truckTypeId && !type) throw new FormError("That truck type no longer exists. Reload the page.");
    await db.truck.update({ where: { id: truckId }, data: { truckTypeId: truckTypeId || null } });
    await audit(me.id, "update", "truck", truckId, `${truck.unitNumber} type → ${type?.name ?? "none"}`);
    refreshOil();
    revalidatePath(`/fleet/${truckId}`);
    return { ok: type ? `${truck.unitNumber} is a ${type.name}` : `${truck.unitNumber} uses its own interval` };
  });
}

/* ------------------------------------------------------------------ */
/* Inline edits on the board                                           */
/* ------------------------------------------------------------------ */

/**
 * Type the odometer of the last oil change straight into the board. The interval restarts from it (nextServiceKm),
 * and so do "used", "due at" and the status. A higher number than before is a newer oil change, dated today; a lower
 * one is a correction and keeps the date. A last change above the truck's odometer moves the odometer up to it (the
 * truck has been at least that far). Empty clears it.
 */
export async function setLastOilChange(truckId: string, value: number | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const fmt = makeFormat(normalizeLocale(me.company));
    const truck = await db.truck.findUnique({
      where: { id: truckId },
      select: { unitNumber: true, odometerKm: true, lastPmKm: true, lastPmAt: true, pmIntervalKm: true, truckType: { select: { oilIntervalKm: true } } },
    });
    if (!truck) throw new FormError("This truck no longer exists. Reload the page.");
    if (value == null) {
      await db.truck.update({ where: { id: truckId }, data: { lastPmKm: null, lastPmAt: null, nextServiceKm: null } });
      await audit(me.id, "update", "truck", truckId, `${truck.unitNumber} last oil change cleared`);
      refreshOil();
      revalidatePath(`/fleet/${truckId}`);
      return { ok: `${truck.unitNumber}: last oil change cleared` };
    }
    if (!Number.isFinite(value) || value < 0) throw new FormError("Enter the odometer at the last oil change");
    const reading = Math.round(value);
    if (reading > truck.odometerKm + MAX_JUMP) {
      throw new FormError(`${fmt.dist(reading)} is far above ${truck.unitNumber}'s odometer of ${fmt.dist(truck.odometerKm)}. Check the digits.`);
    }
    const interval = truck.truckType?.oilIntervalKm ?? truck.pmIntervalKm;
    const newer = truck.lastPmKm == null || reading > truck.lastPmKm;
    const now = new Date();
    await db.truck.update({
      where: { id: truckId },
      data: {
        lastPmKm: reading, nextServiceKm: reading + interval,
        ...(newer ? { lastPmAt: now } : {}),
        ...(reading > truck.odometerKm ? { odometerKm: reading, odometerAt: now } : {}),
      },
    });
    await audit(me.id, "update", "truck", truckId, `${truck.unitNumber} last oil change ${truck.lastPmKm == null ? "—" : fmt.dist(truck.lastPmKm)} → ${fmt.dist(reading)}`);
    refreshOil();
    revalidatePath(`/fleet/${truckId}`);
    return { ok: `${truck.unitNumber}: next oil change at ${fmt.dist(reading + interval)}` };
  });
}

/** The shop (name or address, free text) a truck goes to for its oil change. Empty clears it. */
export async function setOilShop(truckId: string, text: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, oilShop: true } });
    if (!truck) throw new FormError("This truck no longer exists. Reload the page.");
    const oilShop = text.replace(/\s+/g, " ").trim().slice(0, 200) || null;
    if (oilShop === truck.oilShop) return { ok: "No change" };
    await db.truck.update({ where: { id: truckId }, data: { oilShop } });
    await audit(me.id, "update", "truck", truckId, `${truck.unitNumber} oil shop → ${oilShop ?? "none"}`);
    revalidatePath("/maintenance/oil");
    revalidatePath(`/fleet/${truckId}`);
    return { ok: oilShop ? `${truck.unitNumber}: shop saved` : `${truck.unitNumber}: shop cleared` };
  });
}

/* ------------------------------------------------------------------ */
/* Book                                                                */
/* ------------------------------------------------------------------ */

const openOilWhere = (truckId: string) => ({ truckId, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] }, voidedAt: null, repairType: { in: [...OIL_SERVICE_TYPES] } });

/** Book an oil change: a scheduled OIL_CHANGE repair order at the picked shop. */
export async function bookOilChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const tz = me.company.timezone;
  return attempt(async () => {
    const f = fields(fd, tz);
    const truckId = f.req("truckId", "Truck");
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { id: true, unitNumber: true, odometerKm: true } });
    if (!truck) throw new FormError("This truck no longer exists. Reload the page.");
    const booked = await db.workOrder.findFirst({ where: openOilWhere(truckId), select: { number: true } });
    if (booked) throw new FormError(`${truck.unitNumber} is already booked: ${roLabel(booked.number)}`);
    const scheduledAt = stampedDate(fd, "scheduledAt", tz) ?? new Date();
    const vendor = await vendorFromForm(fd);
    const wo = await createWorkOrder({
      truckId, title: "Oil change", repairType: "OIL_CHANGE", category: "PM", status: "OPEN", scheduledAt,
      promisedAt: stampedDate(fd, "promisedAt", tz), ...vendor, odometerKm: truck.odometerKm, description: f.str("description"), createdById: me.id,
    });
    await audit(me.id, "create", "work_order", wo.id, `${roLabel(wo.number)} Oil change`);
    await applyWorkOrderSideEffects(wo.id, "OPEN", me.id, null);
    revalidateRepair(wo.id, { truckId, trailerId: null });
    return { ok: `${roLabel(wo.number)} booked for ${truck.unitNumber}${vendor.vendor ? ` at ${vendor.vendor}` : ""}` };
  });
}

/* ------------------------------------------------------------------ */
/* Log an oil change that was done                                     */
/* ------------------------------------------------------------------ */

/**
 * "Log oil change": one completed repair order with the checklist and any other work as lines. Oil & filter is what
 * resets the interval; without it the visit is kept as a PM service and the interval is left alone. A booking that is
 * still open for the truck is completed instead of opening a second order. Opens the repair order (to attach the
 * invoice file).
 */
export async function logOilChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const tz = me.company.timezone;
  const money = can(me.role, "money.view");
  const fmt = makeFormat(normalizeLocale(me.company));
  let target: string | null = null;
  const res = await attempt(async () => {
    const f = fields(fd, tz);
    const truckId = f.req("truckId", "Truck");
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { id: true, unitNumber: true, odometerKm: true, lastPmKm: true } });
    if (!truck) throw new FormError("This truck no longer exists. Reload the page.");
    const now = new Date();
    const at = stampedDate(fd, "serviceAt", tz) ?? now;
    if (at.getTime() > now.getTime() + 10 * 60_000) throw new FormError("The service time can't be in the future. Book it instead.");
    const odo = f.num("odometerKm");
    if (odo == null) throw new FormError(`Enter the odometer at the service (${fmt.labels.distance})`);
    if (odo < 0) throw new FormError("The odometer can't be negative");
    if (odo > truck.odometerKm + MAX_JUMP) throw new FormError(`${fmt.dist(odo)} is far above ${truck.unitNumber}'s last reading of ${fmt.dist(truck.odometerKm)}. Check the digits.`);
    const reading = Math.round(odo);

    const checked = OIL_CHECKLIST.filter((c) => f.bool(`check_${c.key}`));
    const oil = checked.some((c) => c.key === "OIL_FILTER");
    const other = readLines(fd, money);
    const lines = [...checked.map((c) => ({ system: "PM", work: c.work, amount: 0 })), ...other];
    if (!lines.length) throw new FormError("Tick what was done, or add a line of other work");

    const invoice = { invoiceTotal: null as number | null, invoiceNumber: null as string | null, paymentStatus: null as string | null };
    if (money) {
      const total = f.num("invoiceTotal");
      if (total == null) throw new FormError("Enter the invoice total (0 if it was done in-house at no charge)");
      if (total < 0) throw new FormError("The invoice total can't be negative");
      const paymentStatus = f.str("paymentStatus");
      if (paymentStatus && !(PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) throw new FormError("Pick whether the invoice is paid");
      if (!paymentStatus && total > 0) throw new FormError("Say whether the invoice is paid or still to pay");
      Object.assign(invoice, { invoiceTotal: Math.round(total * 100) / 100, invoiceNumber: f.str("invoiceNumber"), paymentStatus });
      // The checklist has no prices: what the invoice charged beyond the other work goes on the first ticked item,
      // so the lines add up to the invoice.
      const rest = Math.round((total - other.reduce((a, l) => a + (l.amount ?? 0), 0)) * 100) / 100;
      if (checked.length && rest > 0) lines[0] = { ...lines[0], amount: rest };
    }
    const vendor = await vendorFromForm(fd);
    const repairType = oil ? "OIL_CHANGE" : "PM_INSPECTION";
    const data = {
      truckId, title: oil ? "Oil change" : "PM service", repairType, category: "PM", status: "DONE",
      inAt: at, outAt: at, completedAt: at, odometerKm: reading, odometerOutKm: reading,
      ...vendor, ...invoice, cost: costOf(invoice.invoiceTotal, lines), description: f.str("description"),
    };

    const booking = await db.workOrder.findFirst({ where: { ...openOilWhere(truckId), status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } }, orderBy: { scheduledAt: "asc" }, select: { id: true, number: true, status: true, vendorId: true, vendor: true, inAt: true } });
    let id: string;
    let number: number;
    if (booking) {
      // Completing the booking: keep its shop when none was picked, and its in-shop time when it went in earlier.
      await db.workOrder.update({
        where: { id: booking.id },
        data: { ...data, vendorId: vendor.vendorId ?? booking.vendorId, vendor: vendor.vendor ?? booking.vendor, inAt: booking.inAt && booking.inAt < at ? booking.inAt : at },
      });
      id = booking.id; number = booking.number;
      await audit(me.id, "update", "work_order", id, `${roLabel(number)} logged as done`);
    } else {
      const wo = await createWorkOrder({ ...data, scheduledAt: at, createdById: me.id });
      id = wo.id; number = wo.number;
      await audit(me.id, "create", "work_order", id, `${roLabel(number)} ${data.title}`);
    }
    await replaceLines(id, lines);
    await applyWorkOrderSideEffects(id, "DONE", me.id, booking?.status ?? null);
    if (money && invoice.invoiceTotal != null) {
      await logEvent(id, "INVOICE", me.id, { body: [invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : "Invoice", fmt.money2(invoice.invoiceTotal)].join(" · ") });
    }
    if (!oil) await logEvent(id, "NOTE", me.id, { body: "Logged without oil & filter, so the oil interval was not reset." });
    revalidateRepair(id, { truckId, trailerId: null });
    target = `/maintenance/work-orders/${id}?logged=${oil ? "oil" : "pm"}`;
  });
  if (res?.error) return res;
  redirect(target!);
}
