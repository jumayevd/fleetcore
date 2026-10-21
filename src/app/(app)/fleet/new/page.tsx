import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { saveTruck } from "../actions";
import { TruckForm } from "../truck-form";

export const metadata = { title: "Add truck" };

export default async function NewTruck() {
  await requireUser("fleet.edit");
  const [drivers, groups] = await Promise.all([
    db.driver.findMany({ where: { truck: null, status: { not: "INACTIVE" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.truck.findMany({ where: { group: { not: null } }, distinct: ["group"], select: { group: true } }),
  ]);
  return (
    <>
      <PageHeader eyebrow="Fleet · Trucks" title="Add truck" subtitle="Identity, ownership, service schedule and paperwork dates. You can upload documents after saving." />
      <TruckForm action={saveTruck.bind(null, null)} drivers={drivers} groups={groups.map((g) => g.group!).sort()} cancelHref="/fleet" />
    </>
  );
}
