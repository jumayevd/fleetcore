import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveDriver } from "@/app/actions/people";
import { PageHeader } from "@/components/ui";
import { DriverForm } from "../../driver-form";

export const metadata = { title: "Edit driver" };

export default async function EditDriver({ params }: PageProps<"/drivers/[id]/edit">) {
  await requireUser("drivers.edit");
  const { id } = await params;
  const [driver, teams] = await Promise.all([
    db.driver.findUnique({ where: { id } }),
    db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
  ]);
  if (!driver) notFound();
  return (
    <>
      <PageHeader eyebrow="Drivers" title={`Edit ${driver.name}`} />
      <DriverForm action={saveDriver.bind(null, id)} driver={driver} teams={teams} cancelHref={`/drivers/${id}`} />
    </>
  );
}
