import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { saveTruck } from "@/app/actions/fleet";
import { TruckForm } from "../../truck-form";
import { driverOptions } from "../../driver-options";
import { truckTypeOptions } from "../../data";
import { DeleteUnit } from "../../delete-unit";
import { countOf } from "../../lib";

export async function generateMetadata({ params }: PageProps<"/fleet/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const t = await db.truck.findUnique({ where: { id: (await params).id }, select: { unitNumber: true } });
  return { title: t ? `Edit ${t.unitNumber}` : "Not found" };
}

export default async function EditTruck({ params }: PageProps<"/fleet/[id]/edit">) {
  const me = await requireUser("fleet.edit");
  const { id } = await params;
  const truck = await db.truck.findUnique({
    where: { id },
    include: { _count: { select: { workOrders: true, documents: true, defects: true, walkArounds: true, fuelLogs: true, assignments: true } } },
  });
  if (!truck) notFound();
  const c = truck._count;
  const removes = [
    countOf(c.workOrders, "repair"), countOf(c.documents, "document"), countOf(c.defects, "defect"), countOf(c.walkArounds, "walk-around"),
    countOf(c.fuelLogs, "fuel entry", "fuel entries"), countOf(c.assignments, "driver stint"),
  ].filter((x): x is string => Boolean(x));
  const [drivers, groups, types] = await Promise.all([
    driverOptions(truck.driverId),
    db.truck.findMany({ where: { group: { not: null } }, distinct: ["group"], select: { group: true } }),
    truckTypeOptions(),
  ]);
  return (
    <>
      <PageHeader title={<>Edit <span className="num">{truck.unitNumber}</span></>} subtitle={`${truck.year} ${truck.make} ${truck.model}${truck.plate ? ` · ${truck.plate}` : ""}`} />
      <TruckForm action={saveTruck.bind(null, id)} truck={truck} drivers={drivers} groups={groups.map((g) => g.group!).sort()} types={types} cancelHref={`/fleet/${id}`} />
      {can(me.role, "fleet.delete") && <div className="mt-6"><DeleteUnit kind="truck" id={id} unitNumber={truck.unitNumber} removes={removes} /></div>}
    </>
  );
}
