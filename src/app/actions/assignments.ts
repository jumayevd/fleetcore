"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fields, FormError } from "@/lib/action";
import { getFormat } from "@/lib/format-server";
import { startOfDayIn } from "@/lib/locale";
import { setTruckDriver } from "@/lib/assignments";
import { parseHandover } from "@/lib/handover";

/*
 * The truck page's Driver tab: change, take off and edit a driver's stint on a truck (src/lib/assignments.ts).
 * Pickup photos are uploaded afterwards to /api/documents with the returned assignment id.
 */

/** ActionState plus the stint the photos belong to. */
export type AssignResult = { ok?: string; error?: string; assignmentId?: string };

function refresh(truckId: string, ...driverIds: (string | null | undefined)[]) {
  revalidatePath(`/fleet/${truckId}`);
  revalidatePath("/fleet");
  revalidatePath("/drivers");
  for (const d of driverIds) if (d) revalidatePath(`/drivers/${d}`);
  revalidatePath("/dashboard");
  revalidatePath("/tracking");
  revalidatePath("/inspections");
}

/** A day from the form: required, and not after today (company time). */
function readDay(f: ReturnType<typeof fields>, name: string, label: string, tz: string) {
  const day = f.date(name);
  if (!day) throw new FormError(`${label} is required`);
  if (day.getTime() > startOfDayIn(new Date(), tz).getTime()) throw new FormError(`${label} can't be in the future.`);
  return day;
}

const note = (v: string | null) => (v ? v.slice(0, 1000) : null);

async function run(fn: () => Promise<AssignResult>): Promise<AssignResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FormError) return { error: e.message };
    throw e;
  }
}

/** Give the truck a new driver (or its first). A driver who drives another truck moves over from it the same day. */
export async function changeTruckDriver(truckId: string, fd: FormData): Promise<AssignResult> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  let touched: (string | null)[] = [];
  const res = await run(async () => {
    const f = fields(fd, me.company.timezone);
    const driverId = f.req("driverId", "New driver");
    const day = readDay(f, "startedAt", "Assigned date", me.company.timezone);
    const [driver, truck] = await Promise.all([
      db.driver.findUnique({ where: { id: driverId }, select: { name: true, status: true } }),
      db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, status: true } }),
    ]);
    if (!driver) throw new FormError("That driver no longer exists. Pick another one.");
    if (!truck) throw new FormError("This truck no longer exists.");
    if (driver.status === "INACTIVE") throw new FormError(`${driver.name} is inactive. Set them back to active on their page first.`);
    if (truck.status === "INACTIVE") throw new FormError(`${truck.unitNumber} is inactive. Reactivate it before giving it a driver.`);
    const before = await db.truck.findUnique({ where: { id: truckId }, select: { driverId: true } });
    const r = await setTruckDriver({
      truckId, driverId, day, userId: me.id, handover: parseHandover(f.str("handover")), note: note(f.str("note")), dayLabel: fmt.date,
    });
    if (!r.changed) throw new FormError(`${driver.name} already drives ${truck.unitNumber}. Use Edit to change the date, the handover or the note.`);
    touched = [driverId, before?.driverId ?? null];
    await audit(me.id, "assign driver", "truck", truckId,
      `${driver.name} from ${fmt.date(day)}${r.previous ? ` (was ${r.previous})` : ""}${r.moved ? `; moved from ${r.moved.unitNumber}` : ""}`);
    await audit(me.id, "assign truck", "driver", driverId, `${driver.name} → ${truck.unitNumber}${r.moved ? ` (was ${r.moved.unitNumber})` : ""}`);
    return {
      ok: `${driver.name} now drives ${truck.unitNumber}${r.moved ? `; ${r.moved.unitNumber} has no driver now` : ""}.`,
      assignmentId: r.assignmentId ?? undefined,
    };
  });
  if (!res.error) refresh(truckId, ...touched);
  return res;
}

/** Take the driver off the truck: their stint ends on the given day. */
export async function unassignTruckDriver(truckId: string, fd: FormData): Promise<AssignResult> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  let driverId: string | null = null;
  const res = await run(async () => {
    const f = fields(fd, me.company.timezone);
    const day = readDay(f, "endedAt", "Last day", me.company.timezone);
    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, driverId: true, driver: { select: { name: true } } } });
    if (!truck) throw new FormError("This truck no longer exists.");
    if (!truck.driverId) throw new FormError(`${truck.unitNumber} has no driver.`);
    driverId = truck.driverId;
    await setTruckDriver({ truckId, driverId: null, day, userId: me.id, endNote: note(f.str("endNote")), dayLabel: fmt.date });
    await audit(me.id, "unassign driver", "truck", truckId, `${truck.driver?.name ?? "Driver"} until ${fmt.date(day)}`);
    await audit(me.id, "unassign truck", "driver", truck.driverId, `${truck.driver?.name ?? "Driver"} no longer drives ${truck.unitNumber}`);
    return { ok: `${truck.driver?.name ?? "The driver"} no longer drives ${truck.unitNumber}.` };
  });
  if (!res.error) refresh(truckId, driverId);
  return res;
}

/** Correct a stint: its days, what went with the unit, the notes. */
export async function updateAssignment(assignmentId: string, fd: FormData): Promise<AssignResult> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  let truckId = "";
  let driverId = "";
  const res = await run(async () => {
    const f = fields(fd, me.company.timezone);
    const a = await db.driverAssignment.findUnique({ where: { id: assignmentId }, select: { id: true, truckId: true, driverId: true, endedAt: true, driver: { select: { name: true } } } });
    if (!a) throw new FormError("This record no longer exists. Refresh the page.");
    truckId = a.truckId;
    driverId = a.driverId;
    const startedAt = readDay(f, "startedAt", "Assigned date", me.company.timezone);
    const endedAt = a.endedAt ? readDay(f, "endedAt", "Last day", me.company.timezone) : null;
    if (endedAt && endedAt.getTime() < startedAt.getTime()) throw new FormError("The last day can't be before the assigned date.");
    // Stints of one truck follow each other: this one can't reach into the one before or after it.
    const [prev, next] = await Promise.all([
      db.driverAssignment.findFirst({ where: { truckId: a.truckId, id: { not: a.id }, startedAt: { lt: startedAt } }, orderBy: { startedAt: "desc" }, select: { endedAt: true, driver: { select: { name: true } } } }),
      a.endedAt ? db.driverAssignment.findFirst({ where: { truckId: a.truckId, id: { not: a.id }, startedAt: { gte: a.endedAt } }, orderBy: { startedAt: "asc" }, select: { startedAt: true, driver: { select: { name: true } } } }) : null,
    ]);
    if (prev?.endedAt && prev.endedAt.getTime() > startedAt.getTime()) throw new FormError(`${prev.driver.name} had the truck until ${fmt.date(prev.endedAt)}. Start on that day or later.`);
    if (next && endedAt && endedAt.getTime() > next.startedAt.getTime()) throw new FormError(`${next.driver.name} took the truck on ${fmt.date(next.startedAt)}. End on that day or earlier.`);
    await db.driverAssignment.update({
      where: { id: a.id },
      data: {
        startedAt, endedAt, backfilled: false,
        handover: parseHandover(f.str("handover")) as Prisma.InputJsonValue,
        note: note(f.str("note")),
        ...(a.endedAt ? { endNote: note(f.str("endNote")) } : {}),
      },
    });
    await audit(me.id, "update assignment", "truck", a.truckId, `${a.driver.name}: from ${fmt.date(startedAt)}${endedAt ? ` to ${fmt.date(endedAt)}` : ""}`);
    return { ok: "Saved.", assignmentId: a.id };
  });
  if (!res.error && truckId) refresh(truckId, driverId);
  return res;
}
