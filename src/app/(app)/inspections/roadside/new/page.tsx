import { requireUser } from "@/lib/auth";
import { getFormat } from "@/lib/format-server";
import { one } from "@/lib/pti-shared";
import { PageHeader } from "@/components/ui";
import { RoadsideForm } from "@/components/inspections/roadside-form";
import { saveRoadside } from "@/app/actions/roadside";
import { roadsideFormOptions } from "../data";

export const metadata = { title: "Log a roadside inspection" };

export default async function NewRoadside({ searchParams }: PageProps<"/inspections/roadside/new">) {
  await requireUser("fleet.edit");
  const f = await getFormat();
  const sp = await searchParams;
  const options = await roadsideFormOptions();
  // ?driver= / ?truck= / ?trailer= prefill from a driver or unit page.
  const driverId = options.drivers.find((d) => d.id === one(sp.driver))?.id ?? "";
  const truckId = options.trucks.find((t) => t.id === one(sp.truck))?.id ?? options.drivers.find((d) => d.id === driverId)?.truckId ?? "";
  const trailerId = options.trailers.find((t) => t.id === one(sp.trailer))?.id ?? options.trucks.find((t) => t.id === truckId)?.trailerId ?? "";

  return (
    <>
      <PageHeader title="Log a roadside inspection" subtitle="Copy it from the inspection report the driver got. Clean inspections count too." />
      <RoadsideForm
        action={saveRoadside.bind(null, null)}
        {...options}
        editing={false}
        submitLabel="Save inspection"
        cancelHref="/inspections/roadside"
        initial={{
          inspectedAt: f.dateTimeInput(new Date()), reportNumber: "", level: 1, state: "", location: "",
          driverId, truckId: truckId ?? "", trailerId: trailerId ?? "", correctionDueAt: "", status: "OPEN", notes: "", violations: [],
        }}
      />
    </>
  );
}
