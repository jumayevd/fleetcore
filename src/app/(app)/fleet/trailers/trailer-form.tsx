"use client";

import { useState } from "react";
import type { Trailer } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { useFormat } from "@/components/locale";
import { Card, Field, InfoTip, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { EQUIPMENT, EQUIPMENT_LABELS, TRAILER_STATUSES, TRAILER_STATUS_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/action";
import { GPS_PROVIDERS, UNHOOKED_TRAILER_STATUSES } from "../lib";

/** Saving opens the trailer page (the action redirects). Capacity is in the company's weight unit. */
export function TrailerForm({ action, trailer, trucks, cancelHref }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  trailer?: Trailer | null;
  trucks: { id: string; label: string }[];
  cancelHref: string;
}) {
  const f = useFormat();
  // A new trailer starts in the yard; pick In use or Empty to pair it with a tractor.
  const [status, setStatus] = useState(trailer?.status ?? "YARD");
  const [truckId, setTruckId] = useState(trailer?.truckId ?? "");
  const unhooked = UNHOOKED_TRAILER_STATUSES.includes(status);
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Identity">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Unit number" required><Input name="unitNumber" required defaultValue={trailer?.unitNumber} placeholder="TR-220" className="num" /></Field>
              <Field label="Type" required><Select name="type" required defaultValue={trailer?.type ?? "DRY_VAN"} options={EQUIPMENT.map((e) => ({ value: e, label: EQUIPMENT_LABELS[e] }))} /></Field>
              <Field label={`Capacity (${f.labels.weight})`}>
                <Input name="capacityKg" type="number" min={0} step={500} defaultValue={trailer?.capacityKg ?? (f.imperial ? 45000 : 22000)} className="num" />
              </Field>
              <Field label="Plate"><Input name="plate" defaultValue={trailer?.plate ?? ""} placeholder="Plate number" className="num uppercase" /></Field>
              <Field label="Year"><Input name="year" type="number" min={1990} max={2100} defaultValue={trailer?.year ?? ""} className="num" /></Field>
            </div>
          </Card>

          <Card title={
            <span className="flex items-center gap-1.5">Status &amp; pairing
              <InfoTip>{trailer ? "Changing the status restarts its time-in-status counter. " : ""}Dropped, Yard, Shop and Out of service unpair the truck. Leave GPS provider empty if the trailer has no tracker.</InfoTip>
            </span>
          }>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Status">
                <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)} options={TRAILER_STATUSES.map((s) => ({ value: s, label: TRAILER_STATUS_LABELS[s] }))} />
              </Field>
              <Field label="Paired truck" hint={unhooked ? `${TRAILER_STATUS_LABELS[status]} trailers aren't paired. Set In use or Empty to pair a truck.` : trucks.length ? undefined : "No trucks yet. Add one under Trucks to pair it."}>
                <Select name="truckId" value={unhooked ? "" : truckId} onChange={(e) => setTruckId(e.target.value)} disabled={unhooked}
                  placeholder="Not paired" options={trucks.map((t) => ({ value: t.id, label: t.label }))} />
              </Field>
              <Field label="Location"><Input name="locationName" defaultValue={trailer?.locationName ?? ""} placeholder="Yard, site or city" /></Field>
              <Field label="GPS provider">
                <Input name="gpsProvider" list="gps-providers" defaultValue={trailer?.gpsProvider ?? ""} placeholder="Samsara" />
                <datalist id="gps-providers">{GPS_PROVIDERS.map((p) => <option key={p} value={p} />)}</datalist>
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Paperwork dates<InfoTip>Upload the registration, insurance and annual inspection on the trailer page; their dates update these.</InfoTip></span>}>
            <div className="space-y-4">
              <Field label="Annual inspection due"><Input name="inspectionExpiry" type="date" defaultValue={f.dateInput(trailer?.inspectionExpiry)} /></Field>
              <Field label="Insurance expiry"><Input name="insuranceExpiry" type="date" defaultValue={f.dateInput(trailer?.insuranceExpiry)} /></Field>
            </div>
          </Card>
          <Card title="Notes">
            <Textarea name="notes" rows={5} defaultValue={trailer?.notes ?? ""} placeholder="Door seal replaced, reefer unit serial, tire sizes…" />
          </Card>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
        <SubmitButton pendingText={trailer ? "Saving…" : "Adding…"}>{trailer ? "Save changes" : "Add trailer"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
