import "server-only";
import { db } from "@/lib/db";
import { humanize } from "@/lib/constants";

/**
 * Trucks a driver can be given: every truck without a driver (not retired), plus the driver's current one, as picker
 * options ("T-104 · Volvo FH16 · in maintenance").
 */
export async function truckOptions(driverId: string | null) {
  const trucks = await db.truck.findMany({
    where: { OR: [{ driverId: null, status: { not: "INACTIVE" } }, ...(driverId ? [{ driverId }] : [])] },
    orderBy: { unitNumber: "asc" },
    select: { id: true, unitNumber: true, make: true, model: true, status: true },
  });
  return trucks.map((t) => ({
    value: t.id,
    label: `${t.unitNumber} · ${t.make} ${t.model}${t.status !== "ACTIVE" ? ` · ${humanize(t.status).toLowerCase()}` : ""}`,
  }));
}
