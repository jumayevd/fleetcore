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
import { isSeat, type Seat } from "@/lib/assignments-shared";

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

const seatOf = (f: ReturnType<typeof fields>): Seat => (isSeat(f.str("seat")) ? (f.str("seat") as Seat) : "lead");

/**
 * Give the truck a new driver (or its first), or a team driver (seat "team"). A driver who drives another truck moves
 * over from it the same day.
 */
export async function changeTruckDriver(truckId: string, fd: FormData): Promise<AssignResult> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  let touched: (string | null)[] = [];
  const res = await run(async () => {
    const f = fields(fd, me.company.timezone);
    const seat = seatOf(f);
    const driverId = f.req("driverId", seat === "team" ? "Team driver" : "New driver");
    const day = readDay(f, "startedAt", "Assigned date", me.company.timezone);
    const [driver, truck] = await Promise.all([
      db.driver.findUnique({ where: { id: driverId }, select: { name: true, status: true } }),
      db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, status: true, driverId: true, coDriverId: true } }),
    ]);
    if (!driver) throw new FormError("That driver no longer exists. Pick another one.");
    if (!truck) throw new FormError("This truck no longer exists.");
    if (driver.status === "INACTIVE") throw new FormError(`${driver.name} is inactive. Set them back to active on their page first.`);
    if (truck.status === "INACTIVE") throw new FormError(`${truck.unitNumber} is inactive. Reactivate it before giving it a driver.`);
    const r = await setTruckDriver({
      truckId, driverId, seat, day, userId: me.id, handover: parseHandover(f.str("handover")), note: note(f.str("note")), dayLabel: fmt.date,
    });
    if (!r.changed) throw new FormError(`${driver.name} already drives ${truck.unitNumber}. Use Edit to change the date, the handover or the note.`);
    touched = [driverId, truck.driverId, truck.coDriverId];
    const role = r.seat === "team" ? "team driver" : "driver";
    await audit(me.id, `assign ${role}`, "truck", truckId,
      `${driver.name} from ${fmt.date(day)}${r.previous ? ` (was ${r.previous})` : ""}${r.moved ? `; moved from ${r.moved.unitNumber}` : ""}`);
    await audit(me.id, "assign truck", "driver", driverId, `${driver.name} → ${truck.unitNumber}${r.seat === "team" ? " (team driver)" : ""}${r.moved ? ` (was ${r.moved.unitNumber})` : ""}`);
    return {
      ok: `${driver.name} now drives ${truck.unitNumber}${r.seat === "team" ? " as the team driver" : ""}${r.moved ? `; moved off ${r.moved.unitNumber}` : ""}.`,
      assignmentId: r.assignmentId ?? undefined,
    };
  });
  if (!res.error) refresh(truckId, ...touched);
  return res;
}

/** Take a driver (seat "lead") or the team driver (seat "team") off the truck: their stint ends on the given day. */
export async function unassignTruckDriver(truckId: string, fd: FormData): Promise<AssignResult> {
  const me = await requireUser("fleet.edit");
  const fmt = await getFormat();
  let touched: (string | null)[] = [];
  const res = await run(async () => {
    const f = fields(fd, me.company.timezone);
    const seat = seatOf(f);
    const day = readDay(f, "endedAt", "Last day", me.company.timezone);
    const truck = await db.truck.findUnique({
      where: { id: truckId },
      select: { unitNumber: true, driverId: true, coDriverId: true, driver: { select: { name: true } }, coDriver: { select: { name: true } } },
    });
    if (!truck) throw new FormError("This truck no longer exists.");
    const driverId = seat === "team" ? truck.coDriverId : truck.driverId;
    const name = (seat === "team" ? truck.coDriver?.name : truck.driver?.name) ?? "The driver";
    if (!driverId) throw new FormError(`${truck.unitNumber} has no ${seat === "team" ? "team driver" : "driver"}.`);
    touched = [truck.driverId, truck.coDriverId];
    await setTruckDriver({ truckId, driverId: null, seat, day, userId: me.id, endNote: note(f.str("endNote")), dayLabel: fmt.date });
    // Without the driver, a team driver aboard takes their seat (src/lib/assignments.ts).
    const promoted = seat === "lead" && truck.coDriver ? truck.coDriver.name : null;
    await audit(me.id, seat === "team" ? "unassign team driver" : "unassign driver", "truck", truckId,
      `${name} until ${fmt.date(day)}${promoted ? `; ${promoted} is the driver now` : ""}`);
    await audit(me.id, "unassign truck", "driver", driverId, `${name} no longer drives ${truck.unitNumber}`);
    return { ok: `${name} no longer drives ${truck.unitNumber}.${promoted ? ` ${promoted} is its driver now.` : ""}` };
  });
  if (!res.error) refresh(truckId, ...touched);
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
    // A truck holds two drivers at most (a team), so a stint can't stretch over days when two others already had it.
    // The same driver can't have two stints at once either.
    const overlapping = await db.driverAssignment.findMany({
      where: {
        truckId: a.truckId, id: { not: a.id },
        startedAt: endedAt ? { lt: endedAt } : undefined,
        OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
      },
      orderBy: { startedAt: "asc" },
      select: { driverId: true, startedAt: true, endedAt: true, driver: { select: { name: true } } },
    });
    const self = overlapping.find((s) => s.driverId === a.driverId);
    if (self) throw new FormError(`${a.driver.name} has another stint on this truck from ${fmt.date(self.startedAt)}. Make the days not overlap.`);
    // Two others on the same day inside this stint: the truck would have three drivers that day.
    const end = (s: { endedAt: Date | null }) => s.endedAt?.getTime() ?? Infinity;
    const myEnd = endedAt?.getTime() ?? Infinity;
    for (const [i, x] of overlapping.entries()) {
      const third = overlapping.slice(i + 1).find((y) =>
        Math.max(x.startedAt.getTime(), y.startedAt.getTime(), startedAt.getTime()) < Math.min(end(x), end(y), myEnd));
      if (third) throw new FormError(`${x.driver.name} and ${third.driver.name} already had the truck on some of those days. A truck takes two drivers at most.`);
    }
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
