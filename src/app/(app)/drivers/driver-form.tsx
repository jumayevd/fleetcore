import type { Driver } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, InfoTip, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { DRIVER_STATUSES, DRIVER_TYPES, DRIVER_TYPE_LABELS } from "@/lib/constants";
import { toDateInput } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { HoldField } from "./hold-field";
import { EMPLOYMENT_LABELS, type TeamOption } from "./shared";

/**
 * Create / edit a driver. Bound to saveDriver(id | null) from src/app/actions/people.ts.
 * The hold reason input only shows while "On hold" is ticked (client toggle in HoldField).
 */
export function DriverForm({ action, driver, teams, cancelHref }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  driver?: Driver | null;
  teams: TeamOption[];
  cancelHref: string;
}) {
  const editing = Boolean(driver);
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={<span className="flex items-center gap-1.5">Profile<InfoTip>The email is the driver&apos;s sign-in for the driver app.</InfoTip></span>}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Full name" required className="sm:col-span-2 lg:col-span-1"><Input name="name" required defaultValue={driver?.name} placeholder="Family name first, as on the licence" /></Field>
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={driver?.phone ?? ""} placeholder="+998 90 000 00 00" className="num" /></Field>
              <Field label="Second phone"><Input name="phone2" type="tel" defaultValue={driver?.phone2 ?? ""} placeholder="Spare SIM or family contact" className="num" /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={driver?.email ?? ""} /></Field>
              <Field label="Hire date"><Input name="hireDate" type="date" defaultValue={toDateInput(driver?.hireDate ?? new Date())} className="num" /></Field>
              <Field label="Pay per km (USD)"><Input name="payPerKm" type="number" step="0.01" min="0" defaultValue={driver?.payPerKm ?? 0.35} className="num" /></Field>
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-1.5">Licence &amp; medical<InfoTip>Expiring papers raise an alert 30 days ahead and mark the driver at risk. Upload scans on the Documents tab.</InfoTip></span>}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Licence number" required><Input name="licenseNumber" required defaultValue={driver?.licenseNumber} className="num" /></Field>
              <Field label="Licence class"><Input name="licenseClass" defaultValue={driver?.licenseClass ?? "CE"} placeholder="CE" /></Field>
              <Field label="Licence expiry" required><Input name="licenseExpiry" type="date" required defaultValue={toDateInput(driver?.licenseExpiry)} className="num" /></Field>
              <Field label="Medical certificate expiry"><Input name="medicalExpiry" type="date" defaultValue={toDateInput(driver?.medicalExpiry)} className="num" /></Field>
            </div>
          </Card>

          <Card title="Notes">
            <Textarea name="notes" aria-label="Notes" rows={4} defaultValue={driver?.notes ?? ""} placeholder="Preferences, languages, restrictions, anything dispatch should know." />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Employment &amp; dispatch<InfoTip>Driver type sets the weekly production goal and the tag on the boards.</InfoTip></span>}>
            <div className="space-y-4">
              <Field label="Driver type">
                <Select name="type" defaultValue={driver?.type ?? "COMPANY"} options={DRIVER_TYPES.map((t) => ({ value: t, label: DRIVER_TYPE_LABELS[t] }))} />
              </Field>
              {driver ? (
                // Read-only here: the status menu on the driver page checks for an active load and updates the board.
                // The hidden input keeps the current value, because the save action treats a missing status as Active.
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[12px] font-medium text-fg-muted">
                    Employment status
                    <InfoTip>Change it from the status menu on the driver page, which checks for an active load and updates the board.</InfoTip>
                  </p>
                  <input type="hidden" name="status" value={driver.status} />
                  <Badge value={driver.status} label={EMPLOYMENT_LABELS[driver.status] ?? driver.status} dot />
                </div>
              ) : (
                <Field label="Employment status">
                  <Select name="status" defaultValue="ACTIVE" options={DRIVER_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_LABELS[s] }))} />
                </Field>
              )}
              <Field label="Dispatcher team">
                <Select name="teamId" defaultValue={driver?.teamId ?? ""} placeholder="No team" options={teams.map((t) => ({ value: t.id, label: t.name }))} />
              </Field>
              <div className="border-t border-line pt-4">
                <HoldField hold={driver?.hold ?? false} reason={driver?.holdReason ?? null} />
              </div>
            </div>
          </Card>

          {(!editing || !driver?.userId) && (
            <Card title={
              <span className="flex items-center gap-1.5">Driver app login
                <InfoTip>Set a password and the driver can sign in to the mobile portal with the email above to see trips, update stops and upload the POD. They can change it later.</InfoTip>
              </span>
            }>
              {editing && <p className="mb-3 text-[12px] text-fg-muted">This driver has no app login yet.</p>}
              <Field label={editing ? "Initial password" : "Initial password (optional)"}>
                <Input name="password" type="password" minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
              </Field>
            </Card>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
        <SubmitButton>{editing ? "Save changes" : "Add driver"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
