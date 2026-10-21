import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { saveTruck } from "@/app/actions/fleet";
import { TruckForm } from "../truck-form";
import { driverOptions } from "../driver-options";
import { truckTypeOptions } from "../data";

export const metadata = { title: "Add truck" };

export default async function NewTruck() {
  await requireUser("fleet.edit");
  const [drivers, groups, types] = await Promise.all([
    driverOptions(null),
    db.truck.findMany({ where: { group: { not: null } }, distinct: ["group"], select: { group: true } }),
    truckTypeOptions(),
  ]);
  return (
    <>
      <PageHeader title="Add truck" subtitle="Identity, truck type, current odometer, oil service and paperwork dates. Upload the papers after saving." />
      <TruckForm action={saveTruck.bind(null, null)} drivers={drivers} groups={groups.map((g) => g.group!).sort()} types={types} cancelHref="/fleet" />
    </>
  );
}
