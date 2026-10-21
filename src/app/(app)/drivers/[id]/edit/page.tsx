import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { saveDriver } from "@/app/actions/drivers";
import { PageHeader } from "@/components/ui";
import { DriverForm } from "../../driver-form";
import { dispatcherOptions, truckOptions } from "../../data";

export async function generateMetadata({ params }: PageProps<"/drivers/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const d = await db.driver.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: d ? `Edit ${d.name}` : "Not found" };
}

export default async function EditDriver({ params }: PageProps<"/drivers/[id]/edit">) {
  const user = await requireUser("drivers.edit");
  const { id } = await params;
  const driver = await db.driver.findUnique({ where: { id }, include: { truck: { select: { id: true } } } });
  if (!driver) notFound();
  const [trucks, dispatchers] = await Promise.all([can(user.role, "fleet.edit") ? truckOptions(id) : Promise.resolve(null), dispatcherOptions()]);
  return (
    <>
      <PageHeader title={`Edit ${driver.name}`} />
      <DriverForm action={saveDriver.bind(null, id)} driver={driver} trucks={trucks} truckId={driver.truck?.id ?? null} dispatchers={dispatchers} cancelHref={`/drivers/${id}`} />
    </>
  );
}
