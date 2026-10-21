import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { saveDriver } from "@/app/actions/drivers";
import { PageHeader } from "@/components/ui";
import { DriverForm } from "../driver-form";
import { truckOptions } from "../data";

export const metadata = { title: "Add driver" };

export default async function NewDriver() {
  const user = await requireUser("drivers.edit");
  const trucks = can(user.role, "fleet.edit") ? await truckOptions(null) : null;
  return (
    <>
      <PageHeader title="Add driver" subtitle="Profile, licence and medical dates, and a truck if they have one. Upload scans after saving." />
      <DriverForm action={saveDriver.bind(null, null)} trucks={trucks} cancelHref="/drivers" />
    </>
  );
}
