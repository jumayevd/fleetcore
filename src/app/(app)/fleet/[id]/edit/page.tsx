import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { saveTruck } from "@/app/actions/fleet";
import { TruckForm } from "../../truck-form";
import { driverOptions } from "../../driver-options";

export async function generateMetadata({ params }: PageProps<"/fleet/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const t = await db.truck.findUnique({ where: { id: (await params).id }, select: { unitNumber: true } });
  return { title: t ? `Edit ${t.unitNumber}` : "Not found" };
}

export default async function EditTruck({ params }: PageProps<"/fleet/[id]/edit">) {
  await requireUser("fleet.edit");
  const { id } = await params;
  const truck = await db.truck.findUnique({ where: { id } });
  if (!truck) notFound();
  const [drivers, groups] = await Promise.all([
    driverOptions(truck.driverId),
    db.truck.findMany({ where: { group: { not: null } }, distinct: ["group"], select: { group: true } }),
  ]);
  return (
    <>
      <PageHeader title={<>Edit <span className="num">{truck.unitNumber}</span></>} subtitle={`${truck.year} ${truck.make} ${truck.model} · ${truck.plate}`} />
      <TruckForm action={saveTruck.bind(null, id)} truck={truck} drivers={drivers} groups={groups.map((g) => g.group!).sort()} cancelHref={`/fleet/${id}`} />
    </>
  );
}
