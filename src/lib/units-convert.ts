import "server-only";
import { rootDb } from "./db-root";
import type { UnitSystem } from "./locale";

/*
 * Convert every stored distance, volume, weight and speed of one company from one unit system to the other, for when a
 * company switches between imperial and metric and wants its numbers to keep meaning the same thing (a 600,000 km
 * odometer becomes 372,823 mi instead of reading "600,000 mi"). Runs in one transaction; money is never touched.
 *
 * Odometers round to the unit, service intervals to the nearest 100, tank sizes and weights to the unit. Fuel
 * economy flips between MPG and L/100 km (235.215 / x both ways).
 */

const KM_PER_MI = 1.609344;
const L_PER_GAL = 3.785411784;
const KG_PER_LB = 0.45359237;
const ECONOMY = 235.214583;

export async function convertCompanyUnits(companyId: string, from: UnitSystem, to: UnitSystem) {
  if (from === to) return;
  const toMetric = to === "metric";
  const d = toMetric ? KM_PER_MI : 1 / KM_PER_MI;
  const v = toMetric ? L_PER_GAL : 1 / L_PER_GAL;
  const weight = toMetric ? KG_PER_LB : 1 / KG_PER_LB;

  await rootDb.$transaction([
    rootDb.$executeRaw`UPDATE "Truck" SET
        "odometerKm" = ROUND("odometerKm" * ${d}),
        "leaseStartKm" = ROUND("leaseStartKm" * ${d}),
        "leaseAnnualLimitKm" = ROUND("leaseAnnualLimitKm" * ${d}),
        "leaseOverageRate" = "leaseOverageRate" / ${d},
        "pmIntervalKm" = ROUND("pmIntervalKm" * ${d} / 100) * 100,
        "lastPmKm" = ROUND("lastPmKm" * ${d}),
        "nextServiceKm" = ROUND("nextServiceKm" * ${d}),
        "fuelCapacityL" = ROUND("fuelCapacityL" * ${v}),
        "speedKmh" = "speedKmh" * ${d},
        "fuelEconomy" = CASE WHEN "fuelEconomy" > 0 THEN ${ECONOMY} / "fuelEconomy" ELSE NULL END
      WHERE "companyId" = ${companyId}`,
    rootDb.$executeRaw`UPDATE "Trailer" SET "capacityKg" = ROUND("capacityKg" * ${weight}) WHERE "companyId" = ${companyId}`,
    rootDb.$executeRaw`UPDATE "WorkOrder" SET
        "odometerKm" = ROUND("odometerKm" * ${d}),
        "odometerOutKm" = ROUND("odometerOutKm" * ${d})
      WHERE "companyId" = ${companyId}`,
    rootDb.$executeRaw`UPDATE "FuelLog" SET
        "liters" = ROUND(("liters" * ${v})::numeric, 3),
        "odometerKm" = ROUND("odometerKm" * ${d})
      WHERE "companyId" = ${companyId}`,
    rootDb.$executeRaw`UPDATE "TruckType" SET "oilIntervalKm" = ROUND("oilIntervalKm" * ${d} / 100) * 100 WHERE "companyId" = ${companyId}`,
    rootDb.company.update({ where: { id: companyId }, data: { units: to } }),
  ]);
}
