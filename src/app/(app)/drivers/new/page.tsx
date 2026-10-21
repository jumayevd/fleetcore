import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveDriver } from "@/app/actions/people";
import { PageHeader } from "@/components/ui";
import { DriverForm } from "../driver-form";

export const metadata = { title: "Add driver" };

export default async function NewDriver() {
  await requireUser("drivers.edit");
  const teams = await db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } });
  return (
    <>
      <PageHeader eyebrow="Drivers" title="Add driver" subtitle="Profile, papers and dispatch settings. You can upload licence scans after saving." />
      <DriverForm action={saveDriver.bind(null, null)} teams={teams} cancelHref="/drivers" />
    </>
  );
}
