import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EQUIPMENT_LABELS } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import { saveTrailer } from "../../../actions";
import { TrailerForm } from "../../trailer-form";

export async function generateMetadata({ params }: PageProps<"/fleet/trailers/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const t = await db.trailer.findUnique({ where: { id: (await params).id }, select: { unitNumber: true } });
  return { title: t ? `Edit ${t.unitNumber}` : "Not found" };
}

export default async function EditTrailer({ params }: PageProps<"/fleet/trailers/[id]/edit">) {
  await requireUser("fleet.edit");
  const { id } = await params;
  const trailer = await db.trailer.findUnique({ where: { id } });
  if (!trailer) notFound();
  const trucks = await db.truck.findMany({
    where: { OR: [{ status: { not: "INACTIVE" } }, { id: trailer.truckId ?? "" }] }, orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, make: true, model: true },
  });
  return (
    <>
      <PageHeader title={<>Edit <span className="num">{trailer.unitNumber}</span></>} subtitle={`${EQUIPMENT_LABELS[trailer.type] ?? trailer.type}${trailer.year ? ` · ${trailer.year}` : ""}${trailer.plate ? ` · ${trailer.plate}` : ""}`} />
      <TrailerForm action={saveTrailer.bind(null, id)} trailer={trailer} trucks={trucks.map((t) => ({ id: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}` }))} cancelHref={`/fleet/trailers/${id}`} />
    </>
  );
}
