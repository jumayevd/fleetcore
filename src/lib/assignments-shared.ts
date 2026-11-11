import type { Prisma } from "@prisma/client";

/*
 * Team trucks, client-safe helpers. A truck has a driver seat (Truck.driverId) and, for a team, a team driver seat
 * (Truck.coDriverId). A driver sits in one seat of one truck at most, so "the driver's truck" is whichever seat they
 * are in: `truck` (driver) or `teamTruck` (team driver).
 */

export type Seat = "lead" | "team";
export const SEATS: readonly Seat[] = ["lead", "team"];
export const isSeat = (v: unknown): v is Seat => v === "lead" || v === "team";

/** The truck a driver drives, in either seat, and whether as the team driver. */
export function truckOf<T>(d: { truck?: T | null; teamTruck?: T | null }): (T & { team: boolean }) | null {
  if (d.truck) return { ...d.truck, team: false };
  if (d.teamTruck) return { ...d.teamTruck, team: true };
  return null;
}

/** Prisma filter: drivers with no truck in either seat. */
export const NO_TRUCK = { truck: { is: null }, teamTruck: { is: null } } satisfies Prisma.DriverWhereInput;
/** Prisma filter: drivers who drive a truck, in either seat. */
export const HAS_TRUCK: Prisma.DriverWhereInput = { OR: [{ truck: { isNot: null } }, { teamTruck: { isNot: null } }] };
