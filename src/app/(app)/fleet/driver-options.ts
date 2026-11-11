import "server-only";
import { db } from "@/lib/db";
import { NO_TRUCK } from "@/lib/assignments-shared";

export type DriverOption = { id: string; name: string };

/**
 * Drivers the truck form offers (for both seats): active drivers without a truck, plus whoever drives this truck now
 * (driver and team driver, whatever their status), so editing a truck never drops a driver silently. A driver on hold
 * is marked.
 */
export async function driverOptions(...current: (string | null)[]): Promise<DriverOption[]> {
  const aboard = current.filter((x): x is string => Boolean(x));
  const rows = await db.driver.findMany({
    where: { OR: [{ status: "ACTIVE", ...NO_TRUCK }, ...(aboard.length ? [{ id: { in: aboard } }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, hold: true, status: true },
  });
  return rows.map((d) => ({
    id: d.id,
    name: [d.name, d.hold ? "on hold" : null, d.status === "ON_LEAVE" ? "on leave" : d.status === "INACTIVE" ? "inactive" : null].filter(Boolean).join(" · "),
  }));
}
