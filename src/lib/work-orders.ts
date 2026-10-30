import "server-only";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { FormError } from "./action";
import { parseDateInput, parseDateTimeInput } from "./locale";
import { REPAIR_SYSTEMS } from "./constants";
import { truckHeldByDefects } from "./pti";
import { roLabel } from "./service";
import { REPAIR_STATUS_LABELS, resetsInspection, resetsOil, type LineValue } from "@/components/shop/shared";

/*
 * Repair orders (WorkOrder) on the server: numbering, what a status change does to the unit and its service schedule,
 * lines, the timeline and the pages to refresh. The actions in src/app/actions/{repairs,oil,vendors}.ts build on this.
 *
 * Writes go one by one (no interactive transaction): the company scope checks every foreign key against committed
 * rows, so a line can only point at a repair order that is already saved.
 */

type NewWorkOrder = Omit<Prisma.WorkOrderUncheckedCreateInput, "number" | "companyId">;

/**
 * Create a work order with the company's next number (#1, #2, … per company). Two people saving at the same moment can
 * pick the same number; the unique index refuses the second and it simply takes the next one.
 */
export async function createWorkOrder(data: NewWorkOrder) {
  for (let attempt = 0; ; attempt++) {
    const { _max } = await db.workOrder.aggregate({ _max: { number: true } });
    try {
      return await db.workOrder.create({ data: { ...data, number: (_max.number ?? 0) + 1 } });
    } catch (e) {
      const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!clash || attempt >= 4) throw e;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export type EventKind = "STAGE" | "NOTE" | "STATUS" | "DRIVER_INFORMED" | "INVOICE" | "VOID";

export async function logEvent(workOrderId: string, kind: EventKind, userId: string | null, data: { stage?: string | null; body?: string | null } = {}) {
  await db.workOrderEvent.create({ data: { workOrderId, kind, userId, stage: data.stage ?? null, body: data.body ?? null } });
}

/* ------------------------------------------------------------------ */
/* Unit side effects                                                   */
/* ------------------------------------------------------------------ */

export type Unit = { truckId: string | null; trailerId: string | null };

/**
 * Put a unit back in service once no other job holds it in the shop. A truck that a "fix before next load" defect still
 * holds goes back out of service instead: only the person who confirms the repair releases it.
 */
export async function releaseUnit(unit: Unit, workOrderId: string, now: Date) {
  if (unit.truckId) {
    const open = await db.workOrder.count({ where: { truckId: unit.truckId, status: "IN_PROGRESS", id: { not: workOrderId } } });
    if (!open) {
      const held = await truckHeldByDefects(unit.truckId);
      // Back from the shop or from an outside vendor.
      await db.truck.updateMany({ where: { id: unit.truckId, status: { in: ["MAINTENANCE", "VENDOR"] } }, data: { status: held ? "OUT_OF_SERVICE" : "ACTIVE" } });
    }
  }
  if (unit.trailerId) {
    const open = await db.workOrder.count({ where: { trailerId: unit.trailerId, status: "IN_PROGRESS", id: { not: workOrderId } } });
    if (!open) await db.trailer.updateMany({ where: { id: unit.trailerId, status: "SHOP" }, data: { status: "YARD", statusSince: now } });
  }
}

/**
 * What a repair order reaching `status` (from `prevStatus`) does:
 *  - into the shop: the downtime clock starts (inAt), the stage pipeline starts at Diagnosing, the truck goes to In maintenance
 *    (a truck held out of service stays held), a trailer goes to In maintenance (SHOP) and leaves its tractor;
 *  - back to scheduled, or cancelled while in: the unit is released;
 *  - completed: the clock stops (outAt), the unit is released, a newer odometer reading moves the truck's odometer
 *    forward, an oil change restarts the oil interval (the truck type's, else the truck's own) and an annual DOT
 *    inspection moves the inspection expiry a year on — dated by when the unit came back. Defects tied to the order
 *    become "repaired, waiting for someone to confirm".
 */
export async function applyWorkOrderSideEffects(id: string, status: string, userId: string, prevStatus: string | null) {
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id }, include: { truck: { include: { truckType: true } } } });
  const now = new Date();
  if (status === "IN_PROGRESS") {
    await db.workOrder.update({ where: { id }, data: { inAt: wo.inAt ?? now, stage: wo.stage ?? "DIAGNOSING", stageAt: wo.stageAt ?? now } });
    if (!wo.stage) await logEvent(id, "STAGE", userId, { stage: "DIAGNOSING" });
    // A truck a defect holds out of service stays out of service while it is in the shop (src/lib/pti.ts owns that hold).
    if (wo.truckId) await db.truck.updateMany({ where: { id: wo.truckId, status: "ACTIVE" }, data: { status: "MAINTENANCE" } });
    if (wo.trailerId) await db.trailer.updateMany({ where: { id: wo.trailerId, status: { notIn: ["OUT_OF_SERVICE", "INACTIVE"] } }, data: { status: "SHOP", statusSince: now, truckId: null } });
  }
  if ((status === "OPEN" || status === "DRAFT") && prevStatus === "IN_PROGRESS") await releaseUnit(wo, id, now);
  if (status === "CANCELLED" && (prevStatus === "IN_PROGRESS" || (wo.inAt && !wo.outAt))) {
    if (wo.inAt && !wo.outAt) await db.workOrder.update({ where: { id }, data: { outAt: now } });
    await releaseUnit(wo, id, now);
  }
  if (status === "DONE") {
    // A repair logged after the fact keeps its own dates, so it counts in the period the work was done.
    const out = wo.outAt ?? now;
    await db.workOrder.update({ where: { id }, data: { outAt: out, completedAt: wo.completedAt ?? out, inAt: wo.inAt ?? out } });
    await releaseUnit(wo, id, now);
    if (wo.truck) {
      const t = wo.truck;
      const data: Prisma.TruckUncheckedUpdateInput = {};
      // A reading taken in the shop is the newest one there is: it moves the truck's odometer forward, never back.
      const reading = wo.odometerOutKm ?? wo.odometerKm;
      if (reading != null && reading > t.odometerKm) { data.odometerKm = reading; data.odometerAt = out; }
      if (resetsOil(wo)) {
        const odo = wo.odometerKm ?? wo.odometerOutKm ?? (reading != null && reading > t.odometerKm ? reading : t.odometerKm);
        // An older oil change logged late must not wind the schedule back.
        if (odo >= (t.lastPmKm ?? 0)) {
          const interval = t.truckType?.oilIntervalKm ?? t.pmIntervalKm ?? 30000;
          data.lastPmKm = odo; data.lastPmAt = out; data.nextServiceKm = odo + interval;
        }
      }
      if (resetsInspection(wo)) {
        const expiry = new Date(out.getTime() + 365 * 86_400_000);
        if (!t.inspectionExpiry || expiry > t.inspectionExpiry) data.inspectionExpiry = expiry;
      }
      if (Object.keys(data).length) await db.truck.update({ where: { id: t.id }, data });
    }
    // Never closed here: someone confirms the repair on the next walk-around.
    await db.defect.updateMany({ where: { workOrderId: id, status: "OPEN" }, data: { status: "REPAIRED", repairedAt: now } });
  }
  if (prevStatus !== status) {
    const from = prevStatus ? REPAIR_STATUS_LABELS[prevStatus] ?? prevStatus : null;
    await logEvent(id, "STATUS", userId, { body: from ? `${from} → ${REPAIR_STATUS_LABELS[status] ?? status}` : `Opened as ${(REPAIR_STATUS_LABELS[status] ?? status).toLowerCase()}` });
  }
  await audit(userId, "status", "work_order", id, `${roLabel(wo.number)} ${wo.title} → ${status}`);
}

/* ------------------------------------------------------------------ */
/* Form reading                                                        */
/* ------------------------------------------------------------------ */

/**
 * A date field that may come back exactly as stored (an ISO stamp, so saving an unrelated change never rounds a time
 * the buttons recorded) or as typed in a date / datetime-local input, which means company time.
 */
export function stampedDate(fd: FormData, key: string, tz: string): Date | null {
  const raw = fd.get(key);
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = v.includes("T") ? parseDateTimeInput(v, tz) : parseDateInput(v, tz);
  if (!d) throw new FormError(`${key} must be a valid date`);
  return d;
}

/** Repeated lineSystem / lineWork / lineAmount fields → lines. Rows with no work are dropped. */
export function readLines(fd: FormData, withAmounts: boolean): LineValue[] {
  const systems = fd.getAll("lineSystem").map(String);
  const works = fd.getAll("lineWork").map((v) => String(v).trim());
  const amounts = fd.getAll("lineAmount").map(String);
  const lines: LineValue[] = [];
  works.forEach((work, i) => {
    if (!work) return;
    const system = (REPAIR_SYSTEMS as readonly string[]).includes(systems[i]) ? systems[i] : "OTHER";
    const raw = withAmounts ? (amounts[i] ?? "").trim() : "";
    const amount = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(amount)) throw new FormError(`The amount on line ${i + 1} must be a number`);
    if (amount < 0) throw new FormError(`The amount on line ${i + 1} can't be negative`);
    lines.push({ system, work: work.slice(0, 300), amount: Math.round(amount * 100) / 100 });
  });
  return lines;
}

/** Replace a repair order's lines with `lines` (in this order). */
export async function replaceLines(workOrderId: string, lines: LineValue[]) {
  await db.workOrderLine.deleteMany({ where: { workOrderId } });
  if (lines.length) await db.workOrderLine.createMany({ data: lines.map((l, position) => ({ workOrderId, ...l, position })) });
}

export const linesTotal = (lines: { amount: number }[]) => Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;

/**
 * What the order cost, for spend and reports: the invoice total once there is one, else the sum of the lines, else
 * what was recorded before (older orders kept labour + parts).
 */
export function costOf(invoiceTotal: number | null | undefined, lines: { amount: number }[], previous = 0) {
  if (invoiceTotal != null) return invoiceTotal;
  if (lines.length) return linesTotal(lines);
  return previous;
}

/**
 * The shop picked on a form: a vendor (vendorId) or, for older orders, the name typed before vendors existed
 * (vendorName). The order keeps the name in `vendor` as well, so older reports that group by name keep working.
 */
export async function vendorFromForm(fd: FormData) {
  const vendorId = typeof fd.get("vendorId") === "string" ? String(fd.get("vendorId")).trim() : "";
  if (vendorId) {
    const v = await db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } });
    if (!v) throw new FormError("That vendor no longer exists. Pick the shop again.");
    return { vendorId: v.id, vendor: v.name };
  }
  const typed = typeof fd.get("vendorName") === "string" ? String(fd.get("vendorName")).trim() : "";
  return { vendorId: null, vendor: typed || null };
}

/* ------------------------------------------------------------------ */
/* Refresh                                                             */
/* ------------------------------------------------------------------ */

/** Every page that shows the repair order or its unit. */
export function revalidateRepair(id: string | null, ...units: (Unit | null | undefined)[]) {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/maintenance/oil");
  revalidatePath("/vendors");
  revalidatePath("/dashboard");
  // Defects tied to repairs show their repair state on the inspection pages.
  revalidatePath("/inspections");
  revalidatePath("/inspections/defects");
  if (id) revalidatePath(`/maintenance/work-orders/${id}`);
  for (const u of units) {
    if (!u) continue;
    if (u.truckId) revalidatePath(`/fleet/${u.truckId}`);
    if (u.trailerId) revalidatePath(`/fleet/trailers/${u.trailerId}`);
  }
  revalidatePath("/fleet");
  revalidatePath("/fleet/trailers");
}
