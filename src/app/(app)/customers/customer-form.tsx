import type { Customer } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { CUSTOMER_KINDS, CUSTOMER_KIND_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/action";

/** Create / edit a customer or broker. Bound to saveCustomer(id | null) from src/app/actions/people.ts. */
export function CustomerForm({ action, customer, cancelHref }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  customer?: Customer | null;
  cancelHref: string;
}) {
  const editing = Boolean(customer);
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Company">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Company name" required className="sm:col-span-2"><Input name="name" required defaultValue={customer?.name} placeholder="Legal or trading name" /></Field>
              <Field label="Kind" hint="Brokers tender loads and get invoiced; shippers are the cargo owner.">
                <Select name="kind" defaultValue={customer?.kind ?? "SHIPPER"} options={CUSTOMER_KINDS.map((k) => ({ value: k, label: CUSTOMER_KIND_LABELS[k] }))} />
              </Field>
              <Field label="Tax ID (INN)"><Input name="taxId" defaultValue={customer?.taxId ?? ""} className="num" placeholder="9 digits" /></Field>
              <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={customer?.address ?? ""} placeholder="Street, building" /></Field>
              <Field label="City"><Input name="city" defaultValue={customer?.city ?? ""} /></Field>
              <Field label="Country"><Input name="country" defaultValue={customer?.country ?? "Uzbekistan"} /></Field>
            </div>
          </Card>

          <Card title="Contact">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Contact person"><Input name="contactName" defaultValue={customer?.contactName ?? ""} placeholder="Who books and who pays" /></Field>
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={customer?.phone ?? ""} className="num" placeholder="+998 71 000 00 00" /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={customer?.email ?? ""} placeholder="dispatch@company.uz" /></Field>
            </div>
          </Card>

          <Card title="Notes">
            <Textarea name="notes" aria-label="Notes" rows={4} defaultValue={customer?.notes ?? ""} placeholder="Billing quirks, preferred lanes, accessorial rules, who to call after hours." />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Billing">
            <div className="space-y-4">
              <Field label="Payment terms (days)" hint="Invoice due date = issue date + terms. Net 30 is the default.">
                <Input name="paymentTerms" type="number" min="0" step="1" defaultValue={customer?.paymentTerms ?? 30} className="num" />
              </Field>
              <Field label="Credit limit (USD)" hint="Open, unpaid invoices are measured against this on the list and the account page.">
                <Input name="creditLimit" type="number" min="0" step="1000" defaultValue={customer?.creditLimit ?? 50000} className="num" />
              </Field>
            </div>
          </Card>
          {!editing && (
            <Card title="After saving">
              <p className="text-[12px] text-fg-muted">Upload the signed contract (and the setup packet for brokers) on the Documents tab, then book the first load from the account page.</p>
            </Card>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
        <SubmitButton>{editing ? "Save changes" : "Add customer"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
