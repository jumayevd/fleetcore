import Link from "next/link";
import type { Vendor } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Checkbox, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { VENDOR_TYPES, VENDOR_TYPE_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/action";

/** Add / edit vendor. Server-rendered fields inside the client ActionForm. */
export function VendorForm({ action, vendor, cancelHref, submitLabel }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  vendor?: Vendor | null;
  cancelHref: string;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Shop">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2" hint="The name people use for it, not just the street address.">
              <Input name="name" required maxLength={120} defaultValue={vendor?.name ?? ""} placeholder="e.g. Rush Truck Center Joliet" />
            </Field>
            <Field label="Type">
              <Select name="type" defaultValue={vendor?.type ?? "SHOP"} options={VENDOR_TYPES.map((t) => ({ value: t, label: VENDOR_TYPE_LABELS[t] }))} />
            </Field>
            <Field label="City">
              <Input name="city" defaultValue={vendor?.city ?? ""} placeholder="e.g. Joliet, IL" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input name="address" defaultValue={vendor?.address ?? ""} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea name="notes" rows={3} defaultValue={vendor?.notes ?? ""} placeholder="Hours, labour rate, who to ask for, what they are good at" />
            </Field>
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="Contact">
          <div className="space-y-3">
            <Field label="Contact person"><Input name="contactName" defaultValue={vendor?.contactName ?? ""} /></Field>
            <Field label="Phone"><Input name="phone" type="tel" inputMode="tel" defaultValue={vendor?.phone ?? ""} className="num" /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={vendor?.email ?? ""} /></Field>
          </div>
        </Card>
        {vendor && (
          <Card title="Status">
            <Checkbox name="active" defaultChecked={vendor.active} label="Offered when picking a shop" />
            <p className="mt-1.5 text-[11px] text-fg-subtle">Untick to stop offering it for new repairs. Its history stays.</p>
          </Card>
        )}
        <div className="flex items-center gap-2">
          <SubmitButton className="flex-1">{submitLabel}</SubmitButton>
          <Link href={cancelHref} className={buttonClass("secondary")}>Cancel</Link>
        </div>
      </div>
    </ActionForm>
  );
}
