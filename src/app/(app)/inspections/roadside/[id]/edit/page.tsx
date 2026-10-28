import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getFormat } from "@/lib/format-server";
import { PageHeader } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { RoadsideForm } from "@/components/inspections/roadside-form";
import { deleteRoadside, saveRoadside } from "@/app/actions/roadside";
import { roadsideFormOptions, roadsideFormValues } from "../../data";

export const metadata = { title: "Edit DOT inspection" };

export default async function EditRoadside({ params }: PageProps<"/inspections/roadside/[id]/edit">) {
  await requireUser("fleet.edit");
  const { id } = await params;
  const f = await getFormat();
  const [initial, options] = await Promise.all([roadsideFormValues(id, f), roadsideFormOptions()]);
  if (!initial) notFound();

  return (
    <>
      <PageHeader title="Edit DOT inspection" subtitle={initial.reportNumber ? `Report ${initial.reportNumber}` : undefined}
        actions={
          <DeleteButton action={deleteRoadside.bind(null, id)} redirectTo="/inspections/roadside"
            confirm={`Delete ${initial.reportNumber ? `report ${initial.reportNumber}` : "this DOT inspection"} for good? Its violations and attached files go with it. This can't be undone.`} />
        } />
      <RoadsideForm action={saveRoadside.bind(null, id)} {...options} initial={initial} editing submitLabel="Save changes" cancelHref={`/inspections/roadside/${id}`} />
    </>
  );
}
