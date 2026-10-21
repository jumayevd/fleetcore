import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getFormat } from "@/lib/format-server";
import { PageHeader } from "@/components/ui";
import { RoadsideForm } from "@/components/inspections/roadside-form";
import { saveRoadside } from "@/app/actions/roadside";
import { roadsideFormOptions, roadsideFormValues } from "../../data";

export const metadata = { title: "Edit roadside inspection" };

export default async function EditRoadside({ params }: PageProps<"/inspections/roadside/[id]/edit">) {
  await requireUser("fleet.edit");
  const { id } = await params;
  const f = await getFormat();
  const [initial, options] = await Promise.all([roadsideFormValues(id, f), roadsideFormOptions()]);
  if (!initial) notFound();

  return (
    <>
      <PageHeader title="Edit roadside inspection" subtitle={initial.reportNumber ? `Report ${initial.reportNumber}` : undefined} />
      <RoadsideForm action={saveRoadside.bind(null, id)} {...options} initial={initial} editing submitLabel="Save changes" cancelHref={`/inspections/roadside/${id}`} />
    </>
  );
}
