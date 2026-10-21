import type { Driver } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, InfoTip, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { DRIVER_STATUSES, DRIVER_TYPES, DRIVER_TYPE_LABELS } from "@/lib/constants";
import { getFormat } from "@/lib/format-server";
import type { ActionState } from "@/lib/action";
import { HoldField } from "./hold-field";
import { AT_RISK_SCORE, EMPLOYMENT_LABELS } from "./shared";

export type TruckOption = { value: string; label: string };

/**
 * Create / edit a driver (server component). Bound to saveDriver(id | null) from src/app/actions/drivers.ts.
 * `trucks` (free trucks plus the current one) shows the truck picker; pass null when the person can't change the fleet.
 * `dispatchers` are the names already in use, offered as suggestions. Dates default in company time.
 * The hold reason input only shows while "On hold" is ticked (client toggle in HoldField).
 */
export async function DriverForm({ action, driver, trucks, truckId, dispatchers = [], cancelHref }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  driver?: Driver | null;
  trucks: TruckOption[] | null;
  /** The driver's current truck. */
  truckId?: string | null;
  dispatchers?: string[];
  cancelHref: string;
}) {
  const f = await getFormat();
  const editing = Boolean(driver);
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Profile">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Full name" required className="sm:col-span-2 lg:col-span-1"><Input name="name" required defaultValue={driver?.name} placeholder="As on the licence" autoFocus={!editing} /></Field>
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={driver?.phone ?? ""} placeholder="Mobile number" className="num" /></Field>
              <Field label="Second phone"><Input name="phone2" type="tel" defaultValue={driver?.phone2 ?? ""} placeholder="Spare phone or family contact" className="num" /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={driver?.email ?? ""} /></Field>
              <Field label="Hire date"><Input name="hireDate" type="date" defaultValue={f.dateInput(driver?.hireDate ?? new Date())} className="num" /></Field>
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-1.5">Licence &amp; medical<InfoTip>Papers expiring within 30 days mark the driver at risk; expired papers mean they are not cleared to drive. Upload the scans on the Documents tab after saving.</InfoTip></span>}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Licence number" required><Input name="licenseNumber" required defaultValue={driver?.licenseNumber} className="num" /></Field>
              <Field label="Licence class"><Input name="licenseClass" defaultValue={driver?.licenseClass ?? (f.imperial ? "A" : "CE")} placeholder={f.imperial ? "A" : "CE"} /></Field>
              <Field label="Licence expiry" required><Input name="licenseExpiry" type="date" required defaultValue={f.dateInput(driver?.licenseExpiry)} className="num" /></Field>
              <Field label="Medical certificate expiry"><Input name="medicalExpiry" type="date" defaultValue={f.dateInput(driver?.medicalExpiry)} className="num" /></Field>
            </div>
          </Card>

          <Card title="Notes">
            <Textarea name="notes" aria-label="Notes" rows={4} defaultValue={driver?.notes ?? ""} placeholder="Languages, restrictions, medical notes, anything the fleet office should know." />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Employment">
            <div className="space-y-4">
              <Field label="Driver type">
                <Select name="type" defaultValue={driver?.type ?? "COMPANY"} options={DRIVER_TYPES.map((t) => ({ value: t, label: DRIVER_TYPE_LABELS[t] }))} />
              </Field>
              <Field label="Employment status" hint={editing ? "Inactive frees the driver's truck." : undefined}>
                <Select name="status" defaultValue={driver?.status ?? "ACTIVE"} options={DRIVER_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_LABELS[s] }))} />
              </Field>
              <Field label="Dispatcher" hint="Who dispatches this driver: a name or a team. Walk-around videos and repairs are chased through them.">
                <Input name="dispatcher" list="driver-dispatchers" defaultValue={driver?.dispatcher ?? ""} placeholder="Name or team" />
                <datalist id="driver-dispatchers">{dispatchers.map((d) => <option key={d} value={d} />)}</datalist>
              </Field>
              <Field label="Safety score" hint={`0–100. Below ${AT_RISK_SCORE} marks the driver at risk.`}>
                <Input name="score" type="number" min={0} max={100} step={1} defaultValue={driver?.score ?? 100} className="num" />
              </Field>
            </div>
          </Card>

          {trucks && (
            <Card title={<span className="flex items-center gap-1.5">Truck<InfoTip>One driver per truck: only trucks without a driver are listed. To move a truck from another driver, unassign it on their page first.</InfoTip></span>}>
              <Field label="Assigned truck" hint={trucks.length === 0 && !truckId ? "Every truck already has a driver." : undefined}>
                <Select name="truckId" defaultValue={truckId ?? ""} placeholder="No truck" options={trucks} />
              </Field>
            </Card>
          )}

          <Card title="Hold">
            <HoldField hold={driver?.hold ?? false} reason={driver?.holdReason ?? null} />
          </Card>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
        <SubmitButton>{editing ? "Save changes" : "Add driver"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
