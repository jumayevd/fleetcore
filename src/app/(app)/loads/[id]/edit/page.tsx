import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveLoad } from "@/app/actions/loads";
import { EQUIPMENT_LABELS, LOAD_STATUS_LABELS, type LoadStatus } from "@/lib/constants";
import { Badge, PageHeader } from "@/components/ui";
import { LoadForm, type LoadDefaults } from "../../load-form";
import { assignmentOptions, type AssignmentOptions } from "../../options";
import type { StopDefault } from "../../stops-editor";
import { saveLoadDetails } from "./actions";

export const metadata = { title: "Edit load" };

export default async function EditLoadPage({ params }: PageProps<"/loads/[id]/edit">) {
  await requireUser("loads.edit");
  const { id } = await params;
  const load = await db.load.findUnique({ where: { id }, include: { stops: { orderBy: { seq: "asc" } }, customer: { select: { name: true } } } });
  if (!load) notFound();
  const status = load.status as LoadStatus;
  // The invoice already carries the rate and costs; editing the load would make the two disagree.
  if (status === "INVOICED") redirect(`/loads/${id}`);
  const locked = !["PLANNED", "ASSIGNED"].includes(status);
  const options = await withCurrentUnits(await assignmentOptions(id), load);
  const stops: StopDefault[] = load.stops.map((st) => ({
    type: st.type, name: st.name, city: st.city, lat: st.lat, lng: st.lng, address: st.address,
    windowStart: st.windowStart?.toISOString() ?? null, windowEnd: st.windowEnd?.toISOString() ?? null, notes: st.notes, status: st.status,
  }));
  // Only what the form reads — stops travel separately and the rest of the row stays on the server.
  const defaults: LoadDefaults = {
    status: load.status, customerId: load.customerId, brokerId: load.brokerId, customerRef: load.customerRef, teamId: load.teamId,
    priority: load.priority, distanceKm: load.distanceKm, emptyKm: load.emptyKm, commodity: load.commodity, weightKg: load.weightKg,
    pallets: load.pallets, equipment: load.equipment, temperatureC: load.temperatureC, hazmat: load.hazmat, rate: load.rate,
    driverPay: load.driverPay, fuelCost: load.fuelCost, otherCost: load.otherCost, notes: load.notes,
    truckId: load.truckId, driverId: load.driverId, trailerId: load.trailerId,
  };

  return (
    <>
      <PageHeader
        eyebrow={<>Loads / <span className="num">{load.reference}</span></>}
        title={<span className="flex items-center gap-2">Edit <span className="num">{load.reference}</span><Badge value={status} label={LOAD_STATUS_LABELS[status]} dot /></span>}
        subtitle={`${load.customer.name} · ${load.originCity} → ${load.destCity}`}
      />
      <LoadForm action={locked ? saveLoadDetails.bind(null, id) : saveLoad.bind(null, id)} options={options} defaults={defaults} stops={stops} locked={locked}
        submitLabel="Save changes" cancelHref={`/loads/${id}`} />
    </>
  );
}

/**
 * assignmentOptions lists only active units. A load can still point at a truck now in the shop or a driver who
 * left; keep those in the dropdowns (flagged) so the form shows the real assignment instead of silently
 * falling back to the first option.
 */
async function withCurrentUnits(options: AssignmentOptions, load: { truckId: string | null; driverId: string | null; trailerId: string | null }): Promise<AssignmentOptions> {
  const has = (xs: { id: string }[], id: string | null) => !id || xs.some((x) => x.id === id);
  const [truck, driver, trailer] = await Promise.all([
    has(options.trucks, load.truckId) ? null : db.truck.findUnique({ where: { id: load.truckId! }, include: { driver: { select: { id: true, name: true } } } }),
    has(options.drivers, load.driverId) ? null : db.driver.findUnique({ where: { id: load.driverId! }, include: { truck: { select: { id: true } } } }),
    has(options.trailers, load.trailerId) ? null : db.trailer.findUnique({ where: { id: load.trailerId! } }),
  ]);
  const flag = (s: string) => s.toLowerCase().replace(/_/g, " ");
  return {
    ...options,
    trucks: truck
      ? [...options.trucks, { id: truck.id, label: `${truck.unitNumber} · ${truck.make} ${truck.model}`, note: flag(truck.status), pairedDriverId: truck.driver?.id ?? null }]
      : options.trucks,
    drivers: driver
      ? [...options.drivers, { id: driver.id, label: driver.name, note: flag(driver.status), pairedTruckId: driver.truck?.id ?? null, payPerKm: driver.payPerKm, teamId: driver.teamId }]
      : options.drivers,
    trailers: trailer
      ? [...options.trailers, { id: trailer.id, label: `${trailer.unitNumber} · ${EQUIPMENT_LABELS[trailer.type] ?? trailer.type}`, note: flag(trailer.status) }]
      : options.trailers,
  };
}
