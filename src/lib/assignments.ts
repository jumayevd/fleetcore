import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FormError } from "@/lib/action";
import type { HandoverItem } from "@/lib/handover";

/*
 * The one way a truck gets or loses its driver. Truck.driverId stays the quick "who drives it now"; DriverAssignment
 * keeps every stint, so the truck shows who had it when, what went with it and the pickup photos.
 *  - the truck's open stint ends on `day` (the next driver's first day);
 *  - a driver who moves over from another truck ends their stint there the same day, and that truck has no driver;
 *  - the new stint starts on `day`.
 * `day` is a company calendar day (midnight in its time zone). Roles and audit entries are the callers' job.
 */

export type SetTruckDriver = {
  truckId: string;
  /** null takes the driver off the truck. */
  driverId: string | null;
  day: Date;
  userId: string;
  handover?: HandoverItem[];
  note?: string | null;
  /** On the stint that ends (returned keys, damage found…). */
  endNote?: string | null;
  /** How to show a day in a refusal ("Oct 20, 2026"). */
  dayLabel?: (d: Date) => string;
};

const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

export async function setTruckDriver(o: SetTruckDriver) {
  const truck = await db.truck.findUnique({
    where: { id: o.truckId },
    select: { id: true, unitNumber: true, createdAt: true, driverId: true, driver: { select: { name: true } } },
  });
  if (!truck) throw new FormError("This truck no longer exists.");
  const open = await db.driverAssignment.findFirst({ where: { truckId: o.truckId, endedAt: null }, orderBy: { startedAt: "desc" } });
  if (truck.driverId === o.driverId && (open?.driverId ?? null) === o.driverId) {
    return { changed: false as const, unitNumber: truck.unitNumber, previous: truck.driver?.name ?? null, moved: null, assignmentId: open?.id ?? null };
  }
  if (open && o.day.getTime() < open.startedAt.getTime()) {
    const when = o.dayLabel ? o.dayLabel(open.startedAt) : "that day";
    throw new FormError(`The current driver took ${truck.unitNumber} on ${when}. Pick that day or a later one.`);
  }

  // End the truck's current stint. A driver the truck pointed at without a stint (older data) gets one, so the
  // history never skips them.
  if (open) {
    await db.driverAssignment.update({ where: { id: open.id }, data: { endedAt: o.day, endedById: o.userId, endNote: o.endNote ?? null } });
  } else if (truck.driverId) {
    await db.driverAssignment.create({
      data: { truckId: truck.id, driverId: truck.driverId, startedAt: truck.createdAt, endedAt: later(o.day, truck.createdAt), backfilled: true, endedById: o.userId, endNote: o.endNote ?? null },
    });
  }

  // A driver comes off any other truck first: Truck.driverId is unique, and their stint there ends today.
  let moved: { id: string; unitNumber: string } | null = null;
  if (o.driverId) {
    const other = await db.truck.findFirst({ where: { driverId: o.driverId, id: { not: o.truckId } }, select: { id: true, unitNumber: true } });
    if (other) {
      await db.truck.update({ where: { id: other.id }, data: { driverId: null } });
      moved = other;
    }
    const elsewhere = await db.driverAssignment.findMany({ where: { driverId: o.driverId, endedAt: null, truckId: { not: o.truckId } }, select: { id: true, startedAt: true } });
    for (const s of elsewhere) {
      await db.driverAssignment.update({
        where: { id: s.id },
        data: { endedAt: later(o.day, s.startedAt), endedById: o.userId, endNote: `Moved to ${truck.unitNumber}` },
      });
    }
  }

  await db.truck.update({ where: { id: o.truckId }, data: { driverId: o.driverId } });
  const created = o.driverId
    ? await db.driverAssignment.create({
      data: {
        truckId: o.truckId, driverId: o.driverId, startedAt: o.day, createdById: o.userId,
        handover: (o.handover ?? []) as Prisma.InputJsonValue, note: o.note ?? null,
      },
      select: { id: true },
    })
    : null;
  return { changed: true as const, unitNumber: truck.unitNumber, previous: truck.driver?.name ?? null, moved, assignmentId: created?.id ?? null };
}
