import { requireUser } from "@/lib/auth";
import { saveCustomer } from "@/app/actions/people";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Add customer" };

export default async function NewCustomer() {
  await requireUser("customers.edit");
  return (
    <>
      <PageHeader eyebrow="Customers & brokers" title="Add customer" subtitle="A shipper you haul for, a broker who tenders you loads, or both." />
      <CustomerForm action={saveCustomer.bind(null, null)} cancelHref="/customers" />
    </>
  );
}
