import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { saveVendor } from "@/app/actions/vendors";
import { VendorForm } from "../../_components/vendor-form";

export async function generateMetadata({ params }: PageProps<"/vendors/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const v = await db.vendor.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: v ? `Edit ${v.name}` : "Not found" };
}

export default async function EditVendor({ params }: PageProps<"/vendors/[id]/edit">) {
  await requireUser("fleet.edit");
  const { id } = await params;
  const vendor = await db.vendor.findUnique({ where: { id } });
  if (!vendor) notFound();
  return (
    <>
      <PageHeader title={`Edit ${vendor.name}`} subtitle="Renaming it renames it on its repair orders too." />
      <VendorForm action={saveVendor.bind(null, id)} vendor={vendor} cancelHref={`/vendors/${id}`} submitLabel="Save changes" />
    </>
  );
}
