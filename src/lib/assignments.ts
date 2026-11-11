import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FormError } from "@/lib/action";
import type { HandoverItem } from "@/lib/handover";
import type { Seat } from "@/lib/assignments-shared";

/*
 * The one way a truck gets or loses a driver. A truck has two seats: the driver (Truck.driverId) and, for a team, the
 * team driver (Truck.coDriverId). They stay the quick "who drives it now"; DriverAssignment keeps every stint, so the
 * truck shows who had it when, what went with it and the pickup photos. A team truck has two open stints at once.
 *  - the seat's current holder ends their stint on `day` (the next driver's first day);
 *  - a driver who moves over from another truck (either seat) ends their stint there the same day;
 *  - the new stint starts on `day`;
 *  - a team driver never sits alone: when the driver's seat empties, the team driver moves into it, and a team driver
 *    added to a truck without a driver becomes its driver.
 * `day` is a company calendar day (midnight in its time zone). Roles and audit entries are the callers' job.
 */

export type SetTruckDriver = {
  truckId: string;
  /** null takes the seat's driver off the truck. */
  driverId: string | null;
  /** Which seat (default: the driver's). */
  seat?: Seat;
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
const field = (seat: Seat) => (seat === "lead" ? "driverId" : "coDriverId");

/** Empty a seat on another truck; if it was the driver's seat, the team driver (if any) moves into it. */
async function vacate(truck: { id: string; driverId: string | null; coDriverId: string | null }, driverId: string) {
  if (truck.driverId === driverId) {
    await db.truck.update({ where: { id: truck.id }, data: { driverId: truck.coDriverId, coDriverId: null } });
  } else if (truck.coDriverId === driverId) {
    await db.truck.update({ where: { id: truck.id }, data: { coDriverId: null } });
  }
}

export async function setTruckDriver(o: SetTruckDriver) {
  const truck = await db.truck.findUnique({
    where: { id: o.truckId },
    select: { id: true, unitNumber: true, createdAt: true, driverId: true, coDriverId: true, driver: { select: { name: true } }, coDriver: { select: { name: true } } },
  });
  if (!truck) throw new FormError("This truck no longer exists.");
  // A team driver needs a driver beside them: on a truck without one, they take the driver's seat.
  const seat: Seat = o.seat === "team" && truck.driverId ? "team" : "lead";
  const holder = truck[field(seat)];
  const previous = (seat === "lead" ? truck.driver?.name : truck.coDriver?.name) ?? null;
  const open = holder ? await db.driverAssignment.findFirst({ where: { truckId: o.truckId, driverId: holder, endedAt: null }, orderBy: { startedAt: "desc" } }) : null;
  const unchanged = { changed: false as const, unitNumber: truck.unitNumber, previous, moved: null, assignmentId: open?.id ?? null, seat };
  if (holder === o.driverId && (!o.driverId || open)) return unchanged;
  if (open && o.day.getTime() < open.startedAt.getTime()) {
    const when = o.dayLabel ? o.dayLabel(open.startedAt) : "that day";
    throw new FormError(`${truck[seat === "lead" ? "driver" : "coDriver"]?.name ?? "The current driver"} took ${truck.unitNumber} on ${when}. Pick that day or a later one.`);
  }

  const other = seat === "lead" ? truck.coDriverId : truck.driverId;
  if (seat === "team" && o.driverId && o.driverId === other) throw new FormError(`${truck.driver?.name ?? "They"} already drive ${truck.unitNumber}.`);

  // The seat's holder ends their stint. One the truck pointed at without a stint (older data) gets one, so the
  // history never skips them.
  if (holder && holder !== o.driverId) {
    if (open) {
      await db.driverAssignment.update({ where: { id: open.id }, data: { endedAt: o.day, endedById: o.userId, endNote: o.endNote ?? null } });
    } else {
      await db.driverAssignment.create({
        data: { truckId: truck.id, driverId: holder, startedAt: truck.createdAt, endedAt: later(o.day, truck.createdAt), backfilled: true, endedById: o.userId, endNote: o.endNote ?? null },
      });
    }
  }

  // The team driver moving into the driver's seat stays on the truck: their stint goes on.
  if (o.driverId && o.driverId === other) {
    await db.truck.update({ where: { id: o.truckId }, data: { driverId: o.driverId, coDriverId: null } });
    const stint = await db.driverAssignment.findFirst({ where: { truckId: o.truckId, driverId: o.driverId, endedAt: null }, select: { id: true } });
    return { changed: true as const, unitNumber: truck.unitNumber, previous, moved: null, assignmentId: stint?.id ?? null, seat };
  }

  // A driver comes off any other truck first (either seat), and their stint there ends today.
  let moved: { id: string; unitNumber: string } | null = null;
  if (o.driverId) {
    const elsewhere = await db.truck.findFirst({
      where: { id: { not: o.truckId }, OR: [{ driverId: o.driverId }, { coDriverId: o.driverId }] },
      select: { id: true, unitNumber: true, driverId: true, coDriverId: true },
    });
    if (elsewhere) {
      await vacate(elsewhere, o.driverId);
      moved = { id: elsewhere.id, unitNumber: elsewhere.unitNumber };
    }
    const stints = await db.driverAssignment.findMany({ where: { driverId: o.driverId, endedAt: null, truckId: { not: o.truckId } }, select: { id: true, startedAt: true } });
    for (const s of stints) {
      await db.driverAssignment.update({
        where: { id: s.id },
        data: { endedAt: later(o.day, s.startedAt), endedById: o.userId, endNote: `Moved to ${truck.unitNumber}` },
      });
    }
  }

  // The driver's seat emptied with a team driver aboard: the team driver takes it.
  const data = seat === "lead" && !o.driverId && truck.coDriverId
    ? { driverId: truck.coDriverId, coDriverId: null }
    : { [field(seat)]: o.driverId };
  await db.truck.update({ where: { id: o.truckId }, data });
  const created = o.driverId
    ? await db.driverAssignment.create({
      data: {
        truckId: o.truckId, driverId: o.driverId, startedAt: o.day, createdById: o.userId,
        handover: (o.handover ?? []) as Prisma.InputJsonValue, note: o.note ?? null,
      },
      select: { id: true },
    })
    : null;
  return { changed: true as const, unitNumber: truck.unitNumber, previous, moved, assignmentId: created?.id ?? null, seat };
}

/** Take every driver off a truck (it goes inactive): the team driver first, so nobody moves seats on the way out. */
export async function clearTruckDrivers(o: Omit<SetTruckDriver, "driverId" | "seat" | "handover" | "note">) {
  const truck = await db.truck.findUnique({ where: { id: o.truckId }, select: { driverId: true, coDriverId: true } });
  if (truck?.coDriverId) await setTruckDriver({ ...o, driverId: null, seat: "team" });
  if (truck?.driverId) await setTruckDriver({ ...o, driverId: null, seat: "lead" });
  return Boolean(truck?.driverId || truck?.coDriverId);
}
