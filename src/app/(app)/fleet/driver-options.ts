import "server-only";
import { db } from "@/lib/db";

export type DriverOption = { id: string; name: string };

/**
 * Drivers the truck form offers: active drivers without a truck, plus whoever drives this truck now (whatever their
 * status), so editing a truck never drops its driver silently. A driver on hold is marked.
 */
export async function driverOptions(currentDriverId: string | null): Promise<DriverOption[]> {
  const rows = await db.driver.findMany({
    where: { OR: [{ status: "ACTIVE", truck: null }, ...(currentDriverId ? [{ id: currentDriverId }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, hold: true, status: true },
  });
  return rows.map((d) => ({
    id: d.id,
    name: [d.name, d.hold ? "on hold" : null, d.status === "ON_LEAVE" ? "on leave" : d.status === "INACTIVE" ? "inactive" : null].filter(Boolean).join(" · "),
  }));
}
