import "server-only";
import { db } from "@/lib/db";
import { humanize } from "@/lib/constants";

/** Dispatcher names already in use, for the form's suggestions and the roster filter. */
export async function dispatcherOptions() {
  const rows = await db.driver.findMany({ where: { dispatcher: { not: null } }, distinct: ["dispatcher"], select: { dispatcher: true } });
  return rows.map((r) => r.dispatcher!).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/**
 * Trucks a driver can be given, as picker options ("T-104 · Volvo FH16 · in maintenance"): every truck with a free seat
 * (no driver, or a driver and no team driver yet: "team with Jane Doe"), not retired, plus the driver's current one.
 */
export async function truckOptions(driverId: string | null) {
  const trucks = await db.truck.findMany({
    where: {
      OR: [
        { status: { not: "INACTIVE" }, coDriverId: null },
        ...(driverId ? [{ driverId }, { coDriverId: driverId }] : []),
      ],
    },
    orderBy: { unitNumber: "asc" },
    select: { id: true, unitNumber: true, make: true, model: true, status: true, driverId: true, driver: { select: { name: true } }, coDriverId: true, coDriver: { select: { name: true } } },
  });
  return trucks.map((t) => {
    // Who else drives it, from this driver's point of view.
    const partner = t.driverId && t.driverId !== driverId ? t.driver?.name : t.coDriverId && t.coDriverId !== driverId ? t.coDriver?.name : null;
    return {
      value: t.id,
      label: `${t.unitNumber} · ${t.make} ${t.model}${partner ? ` · team with ${partner}` : ""}${t.status !== "ACTIVE" ? ` · ${humanize(t.status).toLowerCase()}` : ""}`,
    };
  });
}
