import "server-only";
import { db } from "@/lib/db";
import { EQUIPMENT_LABELS } from "@/lib/constants";
import type { DriverOpt, Opt, TeamOpt, TruckOpt } from "./shared";
export type { DriverOpt, Opt, TeamOpt, TruckOpt } from "./shared";


/**
 * Dropdown options for the load form, assignment and recovery panels.
 * Units committed to another active load are flagged (not removed) so dispatchers can still see the whole fleet.
 */
export async function assignmentOptions(excludeLoadId?: string) {
  const active = await db.load.findMany({
    where: { status: { in: ["ASSIGNED", "IN_TRANSIT"] }, ...(excludeLoadId ? { id: { not: excludeLoadId } } : {}) },
    select: { truckId: true, driverId: true, trailerId: true },
  });
  const busy = new Set(active.flatMap((l) => [l.truckId, l.driverId, l.trailerId]).filter(Boolean) as string[]);
  const [parties, teams, trucks, drivers, trailers] = await Promise.all([
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
    db.truck.findMany({ where: { status: "ACTIVE" }, orderBy: { unitNumber: "asc" }, include: { driver: { select: { id: true, name: true } } } }),
    db.driver.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, include: { truck: { select: { id: true, unitNumber: true } } } }),
    db.trailer.findMany({ where: { status: { notIn: ["SHOP", "OUT_OF_SERVICE"] } }, orderBy: { unitNumber: "asc" } }),
  ]);
  const party = (c: { id: string; name: string }) => ({ id: c.id, label: c.name });
  return {
    customers: parties.filter((c) => c.kind === "SHIPPER" || c.kind === "BOTH").map(party),
    brokers: parties.filter((c) => c.kind === "BROKER" || c.kind === "BOTH").map(party),
    teams: teams as TeamOpt[],
    trucks: trucks.map((t): TruckOpt => ({
      id: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}${t.driver ? ` (${t.driver.name})` : ""}`,
      note: busy.has(t.id) ? "busy" : undefined, pairedDriverId: t.driver?.id ?? null,
    })),
    drivers: drivers.map((d): DriverOpt => ({
      id: d.id, label: d.name,
      note: d.hold ? "on hold" : d.boardStatus === "VACATION" ? "vacation" : busy.has(d.id) ? "busy" : undefined,
      pairedTruckId: d.truck?.id ?? null, payPerKm: d.payPerKm, teamId: d.teamId,
    })),
    trailers: trailers.map((t): Opt => ({
      id: t.id, label: `${t.unitNumber} · ${EQUIPMENT_LABELS[t.type] ?? t.type} ${(t.capacityKg / 1000).toFixed(0)}t`,
      note: busy.has(t.id) || t.status === "IN_USE" ? "busy" : undefined,
    })),
  };
}

export type AssignmentOptions = Awaited<ReturnType<typeof assignmentOptions>>;

