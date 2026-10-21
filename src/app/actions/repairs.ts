"use server";

import { redirect } from "next/navigation";
import { startOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { PAYERS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, REPAIR_STAGES, REPAIR_STAGE_LABELS, REPAIR_TYPES, WORK_ORDER_CATEGORIES, WORK_ORDER_STATUSES } from "@/lib/constants";
import { makeFormat, normalizeLocale } from "@/lib/locale";
import { roLabel } from "@/lib/service";
import {
  applyWorkOrderSideEffects, costOf, createWorkOrder, logEvent, readLines, replaceLines, revalidateRepair, stampedDate, vendorFromForm, type Unit,
} from "@/lib/work-orders";
import { SYSTEM_FOR_TYPE, categoryForRepairType, repairTypeForCategory, repairTypeLabel } from "@/components/shop/shared";

/*
 * Repair orders (WorkOrder): create and edit, move between statuses, the stage pipeline, notes, "driver told",
 * close-out, invoice and void. What a status change does to the unit lives in src/lib/work-orders.ts.
 * Expected refusals come back as ActionState: a thrown error's message is hidden in production builds.
 */

const FORM_STATUSES = ["DRAFT", "OPEN", "IN_PROGRESS", "DONE"];
const intOrNull = (n: number | null) => (n == null ? null : Math.round(n));

function checkOdometers(odoIn: number | null, odoOut: number | null) {
  if (odoIn != null && odoIn < 0) throw new FormError("The odometer can't be negative");
  if (odoOut != null && odoOut < 0) throw new FormError("The odometer can't be negative");
  if (odoIn != null && odoOut != null && odoOut < odoIn) throw new FormError("Odometer out can't be lower than odometer in");
}

/** Invoice fields, read only for people who can see money. */
function readInvoice(fd: FormData, tz: string) {
  const f = fields(fd, tz);
  const total = f.num("invoiceTotal");
  if (total != null && total < 0) throw new FormError("The invoice total can't be negative");
  const paymentStatus = f.str("paymentStatus");
  if (paymentStatus && !(PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) throw new FormError("Pick whether the invoice is paid");
  return { invoiceTotal: total == null ? null : Math.round(total * 100) / 100, invoiceNumber: f.str("invoiceNumber"), paymentStatus };
}

const invoiceText = (i: { invoiceNumber: string | null; invoiceTotal: number | null; paymentStatus: string | null }, money: (n: number) => string) =>
  [i.invoiceNumber ? `Invoice ${i.invoiceNumber}` : "Invoice", i.invoiceTotal != null ? money(i.invoiceTotal) : null, i.paymentStatus ? PAYMENT_STATUS_LABELS[i.paymentStatus]?.toLowerCase() : null]
    .filter(Boolean).join(" Â· ");

/* ------------------------------------------------------------------ */
/* Create / edit                                                       */
/* ------------------------------------------------------------------ */

/**
 * The repair order form (new and edit). Checks the order as it is now, not as the page saw it: a job in the shop can
 * only stay in or be completed here, never swap its unit, and a completed or void order keeps its status.
 * Saving opens the repair order.
 */
export async function saveWorkOrder(workOrderId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const tz = me.company.timezone;
  const money = can(me.role, "money.view");
  const fmt = makeFormat(normalizeLocale(me.company));
  let id = workOrderId;
  const units: Unit[] = [];
  const res = await attempt(async () => {
    const f = fields(fd, tz);
    const prev = workOrderId ? await db.workOrder.findUnique({ where: { id: workOrderId }, include: { lines: { orderBy: { position: "asc" } } } }) : null;
    if (workOrderId && !prev) throw new FormError("This repair order no longer exists.");
    const label = prev ? roLabel(prev.number) : "This repair";
    if (prev?.voidedAt || prev?.status === "CANCELLED") throw new FormError(`${label} is void and can't be changed.`);

    const truckId = f.str("truckId");
    const trailerId = f.str("trailerId");
    if (!truckId && !trailerId) throw new FormError("Pick a truck or a trailer");
    const unit: Unit = { truckId: truckId ?? null, trailerId: truckId ? null : trailerId };

    const category = f.str("category");
    const repairType = f.str("repairType") ?? (category ? repairTypeForCategory(category) : "REPAIR");
    if (!(REPAIR_TYPES as readonly string[]).includes(repairType)) throw new FormError("Pick a repair type");
    const rawStatus = f.str("status") ?? "OPEN";
    const status = rawStatus === "SCHEDULED" ? "OPEN" : rawStatus;
    if (!FORM_STATUSES.includes(status)) throw new FormError("Pick whether the unit is scheduled, in the shop or done");

    // A page left open while someone else moved the job on must not move it again.
    const seen = f.str("savedStatus");
    if (prev && seen && seen !== prev.status) {
      throw new FormError(`${label} changed while this page was open. Reload the page before saving.`);
    }
    if (prev?.status === "IN_PROGRESS") {
      if (status !== "IN_PROGRESS" && status !== "DONE") throw new FormError(`${label} is in the shop. Complete it, or void it from the repair page, which releases the unit.`);
      const sameUnit = prev.truckId ? unit.truckId === prev.truckId : !unit.truckId && unit.trailerId === prev.trailerId;
      if (!sameUnit) throw new FormError(`${label} is in the shop on its unit. Complete or void it before moving the work to another unit.`);
    }
    if (prev?.status === "DONE" && status !== "DONE") throw new FormError(`${label} is completed. Its status can't be changed here.`);

    const typedLines = readLines(fd, money);
    // Someone who can't see money never wipes amounts they could not see.
    const lines = money ? typedLines : typedLines.map((l, i) => ({ ...l, amount: prev?.lines[i]?.amount ?? 0 }));

    const payer = f.str("payer") ?? "COMPANY";
    if (!(PAYERS as readonly string[]).includes(payer)) throw new FormError("Pick who pays");
    const chargeDriverId = payer === "DRIVER" ? f.str("chargeDriverId") : null;
    if (payer === "DRIVER") {
      if (!chargeDriverId) throw new FormError("Pick the driver this repair is charged to");
      if (!(await db.driver.count({ where: { id: chargeDriverId } }))) throw new FormError("That driver no longer exists. Pick again.");
    }

    const now = new Date();
    const scheduledAt = stampedDate(fd, "scheduledAt", tz) ?? prev?.scheduledAt ?? now;
    let inAt = stampedDate(fd, "inAt", tz);
    let outAt = stampedDate(fd, "outAt", tz);
    const promisedAt = stampedDate(fd, "promisedAt", tz);
    if (status === "OPEN" || status === "DRAFT") { inAt = null; outAt = null; }
    if (status === "IN_PROGRESS") { inAt = inAt ?? prev?.inAt ?? now; outAt = null; }
    if (status === "DONE") {
      outAt = outAt ?? prev?.outAt ?? now;
      inAt = inAt ?? prev?.inAt ?? outAt;
      if (outAt.getTime() > now.getTime() + 10 * 60_000) throw new FormError("Back in service can't be in the future. Keep it in the shop until it is back.");
    }
    if (inAt && inAt.getTime() > now.getTime() + 10 * 60_000 && status === "IN_PROGRESS") throw new FormError("The in-shop time can't be in the future. Schedule it instead.");
    if (inAt && outAt && outAt < inAt) throw new FormError("Back in service can't be before the unit went into the shop");

    const odometerKm = unit.truckId ? intOrNull(f.num("odometerKm")) : null;
    const odometerOutKm = unit.truckId ? intOrNull(f.num("odometerOutKm")) : null;
    checkOdometers(odometerKm, odometerOutKm);

    if (status === "DONE" && !lines.length) throw new FormError("Add what was done: at least one line before the repair can be completed");

    const invoice = money ? readInvoice(fd, tz) : { invoiceTotal: prev?.invoiceTotal ?? null, invoiceNumber: prev?.invoiceNumber ?? null, paymentStatus: prev?.paymentStatus ?? null };
    if (money && status === "DONE") {
      if (invoice.invoiceTotal == null) throw new FormError("Enter the invoice total for completed work (0 if there was no charge)");
      // Asked when the work is completed; older completed orders can be corrected without it.
      if (!invoice.paymentStatus && invoice.invoiceTotal > 0 && prev?.status !== "DONE") throw new FormError("Say whether the invoice is paid or still to pay");
    }

    const vendor = await vendorFromForm(fd);
    const title = (f.str("title") ?? repairTypeLabel(repairType)).slice(0, 200);
    const sameCharge = prev && prev.payer === "DRIVER" && payer === "DRIVER" && prev.chargeDriverId === chargeDriverId;
    const data = {
      ...unit, title, description: f.str("description"), repairType, category: categoryForRepairType(repairType),
      status, scheduledAt, inAt, outAt, promisedAt, completedAt: status === "DONE" ? outAt : null,
      ...vendor, technician: f.str("technician"),
      payer, chargeDriverId, driverInformedAt: sameCharge ? prev.driverInformedAt : null,
      odometerKm, odometerOutKm, ...invoice,
      cost: costOf(invoice.invoiceTotal, lines, prev?.cost ?? 0),
    } satisfies Prisma.WorkOrderUncheckedUpdateInput;

    if (prev) {
      await db.workOrder.update({ where: { id: prev.id }, data });
      await audit(me.id, "update", "work_order", prev.id, `${roLabel(prev.number)} ${title}`);
    } else {
      const wo = await createWorkOrder({ ...data, createdById: me.id });
      id = wo.id;
      await audit(me.id, "create", "work_order", wo.id, `${roLabel(wo.number)} ${title}`);
    }
    await replaceLines(id!, lines);
    // Opened from a defect: the defect now points at the repair that fixes it.
    const defectId = f.str("defectId");
    if (defectId) await db.defect.updateMany({ where: { id: defectId, status: { not: "CLOSED" } }, data: { workOrderId: id! } });
    if (!prev || prev.status !== status) await applyWorkOrderSideEffects(id!, status, me.id, prev?.status ?? null);
    const invoiceChanged = money && (invoice.invoiceTotal !== (prev?.invoiceTotal ?? null) || invoice.invoiceNumber !== (prev?.invoiceNumber ?? null) || invoice.paymentStatus !== (prev?.paymentStatus ?? null));
    if (invoiceChanged && (invoice.invoiceTotal != null || invoice.invoiceNumber)) await logEvent(id!, "INVOICE", me.id, { body: invoiceText(invoice, fmt.money2) });
    units.push(unit);
  });
  if (res?.error) return res;
  revalidateRepair(id, ...units);
  redirect(`/maintenance/work-orders/${id}`);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/**
 * Move a repair order to `status` (the buttons on the truck and trailer pages). Refusals throw FormError; the callers
 * turn them into ActionState. Completing needs what was done, so an order without lines is sent to its close-out.
 */
export async function setWorkOrderStatus(id: string, status: string) {
  const me = await requireUser("fleet.edit");
  if (!(WORK_ORDER_STATUSES as readonly string[]).includes(status)) throw new FormError("Pick a valid status");
  const prev = await db.workOrder.findUnique({ where: { id }, select: { number: true, status: true, truckId: true, trailerId: true, voidedAt: true, _count: { select: { lines: true } } } });
  if (!prev) throw new FormError("This repair order no longer exists.");
  if (prev.voidedAt) throw new FormError(`${roLabel(prev.number)} is void.`);
  if (status === "DONE" && prev.status !== "DONE" && prev._count.lines === 0) {
    throw new FormError(`${roLabel(prev.number)} needs what was done before it can be completed. Close it out on the repair page.`);
  }
  if (prev.status !== status) {
    await db.workOrder.update({ where: { id }, data: { status, ...(status === "DONE" ? {} : status === "IN_PROGRESS" ? { outAt: null, completedAt: null } : {}) } });
    await applyWorkOrderSideEffects(id, status, me.id, prev.status);
  }
  revalidateRepair(id, prev);
}

/** "Into the shop" on a scheduled repair: the unit goes off the road and the downtime clock starts. */
export async function startRepair(id: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const wo = await db.workOrder.findUnique({ where: { id }, select: { number: true, status: true, truckId: true, trailerId: true, voidedAt: true } });
    if (!wo) throw new FormError("This repair order no longer exists. Refresh the page.");
    if (wo.voidedAt || !["OPEN", "DRAFT"].includes(wo.status)) {
      revalidateRepair(id, wo);
      throw new FormError(`${roLabel(wo.number)} is not waiting to go in any more. The page now shows where it is.`);
    }
    await db.workOrder.update({ where: { id }, data: { status: "IN_PROGRESS", inAt: new Date(), outAt: null, completedAt: null } });
    await applyWorkOrderSideEffects(id, "IN_PROGRESS", me.id, wo.status);
    revalidateRepair(id, wo);
    return { ok: `${roLabel(wo.number)} is in the shop. The downtime clock is running.` };
  });
}

/** Tap a stage on the pipeline, with an optional note. */
export async function setRepairStage(id: string, stage: string, note?: string | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!(REPAIR_STAGES as readonly string[]).includes(stage)) throw new FormError("Pick a stage");
    const wo = await db.workOrder.findUnique({ where: { id }, select: { number: true, status: true, stage: true, voidedAt: true, truckId: true, trailerId: true } });
    if (!wo) throw new FormError("This repair order no longer exists. Refresh the page.");
    if (wo.status !== "IN_PROGRESS" || wo.voidedAt) throw new FormError(`${roLabel(wo.number)} is not in the shop, so it has no stage to move.`);
    const body = note?.trim().slice(0, 1000) || null;
    if (wo.stage === stage && !body) throw new FormError(`Already at ${REPAIR_STAGE_LABELS[stage].toLowerCase()}. Add a note to log an update.`);
    if (wo.stage !== stage) await db.workOrder.update({ where: { id }, data: { stage, stageAt: new Date() } });
    await logEvent(id, "STAGE", me.id, { stage, body });
    await audit(me.id, "stage", "work_order", id, `${roLabel(wo.number)} â†’ ${REPAIR_STAGE_LABELS[stage]}`);
    revalidateRepair(id, wo);
    return { ok: `${roLabel(wo.number)}: ${REPAIR_STAGE_LABELS[stage]}` };
  });
}

/** A note on the repair order's thread. */
export async function addRepairNote(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const body = fields(fd).req("body", "The note").slice(0, 2000);
    const wo = await db.workOrder.findUnique({ where: { id }, select: { number: true } });
    if (!wo) throw new FormError("This repair order no longer exists. Refresh the page.");
    await logEvent(id, "NOTE", me.id, { body });
    await audit(me.id, "note", "work_order", id, roLabel(wo.number));
    revalidateRepair(id);
    return { ok: "Note added" };
  });
}

/** The driver a repair is charged to has been told (nothing comes off their pay before this). */
export async function markDriverInformed(id: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const wo = await db.workOrder.findUnique({ where: { id }, select: { number: true, payer: true, driverInformedAt: true, truckId: true, trailerId: true, chargeDriver: { select: { name: true } } } });
    if (!wo) throw new FormError("This repair order no longer exists. Refresh the page.");
    if (wo.payer !== "DRIVER") throw new FormError(`${roLabel(wo.number)} is not charged to a driver.`);
    if (wo.driverInformedAt) { revalidateRepair(id, wo); return { ok: "Already marked as told" }; }
    await db.workOrder.update({ where: { id }, data: { driverInformedAt: new Date() } });
    const who = wo.chargeDriver?.name ?? "The driver";
    await logEvent(id, "DRIVER_INFORMED", me.id, { body: `${who} told about the charge` });
    await audit(me.id, "driver_informed", "work_order", id, `${roLabel(wo.number)} Â· ${who}`);
    revalidateRepair(id, wo);
    return { ok: `${who} marked as told` };
  });
}

/* ------------------------------------------------------------------ */
/* Close-out, invoice, void                                            */
/* ------------------------------------------------------------------ */

/**
 * Close-out: what was done (at least one line), odometer out and when it came back â†’ completed. Stops the downtime
 * clock, releases the unit and resets the service of that type (see applyWorkOrderSideEffects).
 */
export async function closeOutRepair(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const tz = me.company.timezone;
  const money = can(me.role, "money.view");
  const fmt = makeFormat(normalizeLocale(me.company));
  return attempt(async () => {
    const f = fields(fd, tz);
    const wo = await db.workOrder.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } } });
    if (!wo) throw new FormError("This repair order no longer exists. Refresh the page.");
    if (wo.voidedAt || !["OPEN", "DRAFT", "IN_PROGRESS"].includes(wo.status)) {
      revalidateRepair(id, wo);
      throw new FormError(`${roLabel(wo.number)} is already ${wo.voidedAt ? "void" : "closed"}.`);
    }
    const typed = readLines(fd, money);
    const lines = money ? typed : typed.map((l, i) => ({ ...l, amount: wo.lines[i]?.amount ?? 0 }));
    if (!lines.length) throw new FormError("Add what was done: at least one line");
    const now = new Date();
    const outAt = stampedDate(fd, "outAt", tz) ?? now;
    if (outAt.getTime() > now.getTime() + 10 * 60_000) throw new FormError("Back in service can't be in the future");
    const inAt = wo.inAt ?? stampedDate(fd, "inAt", tz) ?? outAt;
    if (outAt < inAt) throw new FormError("Back in service can't be before the unit went into the shop");
    const odometerOutKm = wo.truckId ? intOrNull(f.num("odometerOutKm")) : null;
    checkOdometers(wo.odometerKm, odometerOutKm);
    const invoice = money ? readInvoice(fd, tz) : { invoiceTotal: wo.invoiceTotal, invoiceNumber: wo.invoiceNumber, paymentStatus: wo.paymentStatus };
    if (money) {
      if (invoice.invoiceTotal == null) throw new FormError("Enter the invoice total (0 if there was no charge)");
      if (!invoice.paymentStatus && invoice.invoiceTotal > 0) throw new FormError("Say whether the invoice is paid or still to pay");
    }
    await db.workOrder.update({
      where: { id },
      data: { inAt, outAt, completedAt: outAt, odometerOutKm, ...invoice, cost: costOf(invoice.invoiceTotal, lines, wo.cost), status: "DONE" },
    });
    await replaceLines(id, lines);
    await applyWorkOrderSideEffects(id, "DONE", me.id, wo.status);
    if (money && (invoice.invoiceTotal !== wo.invoiceTotal || invoice.invoiceNumber !== wo.invoiceNumber || invoice.paymentStatus !== wo.paymentStatus)) {
      await logEvent(id, "INVOICE", me.id, { body: invoiceText(invoice, fmt.money2) });
    }
    revalidateRepair(id, wo);
    const unit = wo.truck?.unitNumber ?? wo.trailer?.unitNumber;
    return { ok: `${roLabel(wo.number)} completed.${unit ? ` ${unit} is back in service.` : ""}` };
  });
}

/** Invoice number, total and payment status (the file is attached with the documents panel). */
export async function saveInvoice(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const fmt = makeFormat(normalizeLocale(me.company));
  return attempt(async () => {
    if (!can(me.role, "money.view")) throw new FormError("Invoices are kept by owners, admins and fleet specialists.");
    const wo = await db.workOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!wo) throw new FormError("This repair order no longer exists. Refresh the page.");
    if (wo.voidedAt) throw new FormError(`${roLabel(wo.number)} is void.`);
    const invoice = readInvoice(fd, me.company.timezone);
    await db.workOrder.update({ where: { id }, data: { ...invoice, cost: costOf(invoice.invoiceTotal, wo.lines, wo.cost) } });
    await logEvent(id, "INVOICE", me.id, { body: invoiceText(invoice, fmt.money2) });
    await audit(me.id, "invoice", "work_order", id, `${roLabel(wo.number)} ${invoiceText(invoice, fmt.money2)}`);
    revalidateRepair(id, wo);
    return { ok: "Invoice saved" };
  });
}

/**
 * Void with a reason: kept for history, out of every count and spend. A unit in the shop is released. The service
 * dates a completed order already moved are left as they are.
 */
export async function voidRepair(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const reason = fields(fd).req("reason", "The reason").slice(0, 500);
    const wo = await db.workOrder.findUnique({ where: { id }, select: { number: true, status: true, truckId: true, trailerId: true, voidedAt: true } });
    if (!wo) throw new FormError("This repair order no longer exists. Refresh the page.");
    if (wo.voidedAt) { revalidateRepair(id, wo); throw new FormError(`${roLabel(wo.number)} is already void.`); }
    await db.workOrder.update({ where: { id }, data: { status: "CANCELLED", voidedAt: new Date(), voidReason: reason } });
    await applyWorkOrderSideEffects(id, "CANCELLED", me.id, wo.status);
    await logEvent(id, "VOID", me.id, { body: reason });
    revalidateRepair(id, wo);
    return { ok: `${roLabel(wo.number)} is void` };
  });
}

/* ------------------------------------------------------------------ */
/* Quick create (truck page)                                           */
/* ------------------------------------------------------------------ */

/**
 * Quick "create" on the truck page: scheduled, in the shop now, or logged as already done. Takes `repairType` (or an
 * older `type` / `category`), `description` (or `title`), `scheduledAt`, `cost`, `odometerKm`, `vendorId` / `vendor`.
 * Work logged as done gets one line from the description, since completed work always says what was done.
 */
export async function saveMaintenance(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const money = can(me.role, "money.view");
  return attempt(async () => {
    const f = fields(fd, me.company.timezone);
    const truckId = f.req("truckId", "Truck");
    const raw = f.str("status") ?? "OPEN";
    const status = raw === "SCHEDULED" ? "OPEN" : raw;
    if (!["OPEN", "IN_PROGRESS", "DONE"].includes(status)) throw new FormError("Pick how the repair starts");
    const legacy = f.str("type") ?? f.str("category");
    const repairType = f.str("repairType") ?? (legacy ? repairTypeForCategory(legacy) : "REPAIR");
    if (!(REPAIR_TYPES as readonly string[]).includes(repairType)) throw new FormError("Pick a repair type");
    const category = legacy && (WORK_ORDER_CATEGORIES as readonly string[]).includes(legacy) && !f.str("repairType") ? legacy : categoryForRepairType(repairType);
    const scheduledAt = f.date("scheduledAt") ?? new Date();
    const now = new Date();
    // Work logged as done on an earlier day is dated that day, so its cost lands in the right month.
    const doneEarlier = status === "DONE" && scheduledAt < startOfDay(now);
    const odometerKm = intOrNull(f.num("odometerKm"));
    if (odometerKm != null && odometerKm < 0) throw new FormError("The odometer can't be negative");
    const cost = money ? (f.num("cost") ?? 0) : 0;
    if (cost < 0) throw new FormError("The cost can't be negative");
    const title = (f.str("title") ?? f.req("description", "What needs doing")).slice(0, 200);
    const vendorId = f.str("vendorId");
    const vendor = vendorId ? await vendorFromForm(fd) : { vendorId: null, vendor: f.str("vendor") };
    const wo = await createWorkOrder({
      truckId, title, repairType, category, status, scheduledAt,
      ...(status === "DONE" ? { inAt: doneEarlier ? scheduledAt : now, outAt: doneEarlier ? scheduledAt : now, completedAt: doneEarlier ? scheduledAt : now } : {}),
      cost, ...vendor, odometerKm, createdById: me.id,
    });
    if (status === "DONE") await replaceLines(wo.id, [{ system: SYSTEM_FOR_TYPE[repairType] ?? "OTHER", work: title, amount: cost }]);
    await audit(me.id, "create", "work_order", wo.id, `${roLabel(wo.number)} ${wo.title}`);
    await applyWorkOrderSideEffects(wo.id, status, me.id, null);
    revalidateRepair(wo.id, { truckId, trailerId: null });
    return { ok: `${roLabel(wo.number)} created` };
  });
}
