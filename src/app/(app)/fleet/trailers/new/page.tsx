import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { saveTrailer } from "../../actions";
import { TrailerForm } from "../trailer-form";

export const metadata = { title: "Add trailer" };

export default async function NewTrailer() {
  await requireUser("fleet.edit");
  const trucks = await db.truck.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, make: true, model: true } });
  return (
    <>
      <PageHeader title="Add trailer" subtitle="Identity, status, pairing and paperwork dates. Upload documents after saving." />
      <TrailerForm action={saveTrailer.bind(null, null)} trucks={trucks.map((t) => ({ id: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}` }))} cancelHref="/fleet/trailers" />
    </>
  );
}
