import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { saveVendor } from "@/app/actions/vendors";
import { VendorForm } from "../../_components/vendor-form";
import { DeleteVendor } from "../../_components/delete-vendor";

export async function generateMetadata({ params }: PageProps<"/vendors/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const v = await db.vendor.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: v ? `Edit ${v.name}` : "Not found" };
}

export default async function EditVendor({ params }: PageProps<"/vendors/[id]/edit">) {
  const me = await requireUser("fleet.edit");
  const { id } = await params;
  const vendor = await db.vendor.findUnique({ where: { id }, include: { _count: { select: { workOrders: true } } } });
  if (!vendor) notFound();
  return (
    <>
      <PageHeader title={`Edit ${vendor.name}`} subtitle="Renaming it renames it on its repair orders too." />
      <VendorForm action={saveVendor.bind(null, id)} vendor={vendor} cancelHref={`/vendors/${id}`} submitLabel="Save changes" />
      {can(me.role, "fleet.delete") && <div className="mt-6"><DeleteVendor id={id} name={vendor.name} repairs={vendor._count.workOrders} /></div>}
    </>
  );
}
