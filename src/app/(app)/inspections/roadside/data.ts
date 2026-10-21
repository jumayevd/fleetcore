import "server-only";
import { db } from "@/lib/db";
import type { Formatter } from "@/lib/locale";
import type { RoadsideFormValues } from "@/components/inspections/roadside-form";
import { byUnit } from "@/lib/pti-shared";

/** Drivers, trucks and trailers for the roadside form (with who drives what, so picking the driver fills the units). */
export async function roadsideFormOptions() {
  const [drivers, trucks, trailers] = await Promise.all([
    db.driver.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { name: "asc" }, select: { id: true, name: true, truck: { select: { id: true, unitNumber: true } } } }),
    db.truck.findMany({ select: { id: true, unitNumber: true, make: true, model: true, trailers: { select: { id: true }, take: 1 } } }),
    db.trailer.findMany({ select: { id: true, unitNumber: true } }),
  ]);
  return {
    drivers: drivers.map((d) => ({ id: d.id, label: d.truck ? `${d.name} · ${d.truck.unitNumber}` : d.name, truckId: d.truck?.id ?? null })),
    trucks: trucks.sort((a, b) => byUnit(a.unitNumber, b.unitNumber)).map((t) => ({ id: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}`, trailerId: t.trailers[0]?.id ?? null })),
    trailers: trailers.sort((a, b) => byUnit(a.unitNumber, b.unitNumber)).map((t) => ({ id: t.id, label: t.unitNumber })),
  };
}

/** Form values for an inspection being edited. */
export async function roadsideFormValues(id: string, f: Formatter): Promise<RoadsideFormValues | null> {
  const r = await db.roadsideInspection.findUnique({ where: { id }, include: { violations: { orderBy: { id: "asc" } } } });
  if (!r) return null;
  return {
    inspectedAt: f.dateTimeInput(r.inspectedAt), reportNumber: r.reportNumber ?? "", level: r.level, state: r.state ?? "", location: r.location ?? "",
    driverId: r.driverId ?? "", truckId: r.truckId ?? "", trailerId: r.trailerId ?? "",
    correctionDueAt: f.dateInput(r.correctionDueAt), status: r.status, notes: r.notes ?? "",
    violations: r.violations.map((v) => ({ id: v.id, code: v.code ?? "", description: v.description, unit: v.unit, oos: v.oos, corrected: Boolean(v.correctedAt) })),
  };
}
