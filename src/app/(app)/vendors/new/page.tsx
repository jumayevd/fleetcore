import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { saveVendor } from "@/app/actions/vendors";
import { VendorForm } from "../_components/vendor-form";

export const metadata = { title: "Add vendor" };

export default async function NewVendor() {
  await requireUser("fleet.edit");
  return (
    <>
      <PageHeader title="Add vendor" subtitle="A shop, dealer, tire or road-side service you send units to." />
      <VendorForm action={saveVendor.bind(null, null)} cancelHref="/vendors" submitLabel="Add vendor" />
    </>
  );
}
