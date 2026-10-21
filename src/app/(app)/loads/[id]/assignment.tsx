"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select } from "@/components/ui";
import { assignLoad, recoverLoad } from "@/app/actions/loads";
import { money } from "@/lib/format";
import { optLabel, type DriverOpt, type Opt, type TruckOpt } from "../shared";

export type UnitOptions = { trucks: TruckOpt[]; drivers: DriverOpt[]; trailers: Opt[] };
type Current = { truckId: string | null; driverId: string | null; trailerId: string | null };

const opt = (xs: Opt[]) => xs.map((x) => ({ value: x.id, label: optLabel(x) }));

/** Truck ↔ driver pairing: picking one side fills the other from the truck's regular driver. */
function usePair(options: UnitOptions, initial: Current) {
  const [truckId, setTruckId] = useState(initial.truckId ?? "");
  const [driverId, setDriverId] = useState(initial.driverId ?? "");
  const onTruck = (id: string) => {
    setTruckId(id);
    const t = options.trucks.find((x) => x.id === id);
    if (t?.pairedDriverId && (!driverId || driverId === initial.driverId)) setDriverId(t.pairedDriverId);
  };
  const onDriver = (id: string) => {
    setDriverId(id);
    const d = options.drivers.find((x) => x.id === id);
    if (d?.pairedTruckId && (!truckId || truckId === initial.truckId)) setTruckId(d.pairedTruckId);
  };
  const truck = options.trucks.find((t) => t.id === truckId);
  const driver = options.drivers.find((d) => d.id === driverId);
  const warnings = [truck?.note && `${truck.label.split(" · ")[0]} is ${truck.note}`, driver?.note && `${driver.label} is ${driver.note}`].filter(Boolean) as string[];
  return { truckId, driverId, onTruck, onDriver, truck, driver, warnings };
}

/** Assign or reassign a booked / dispatched load (assignLoad). */
export function AssignForm({ loadId, options, current, distanceKm }: { loadId: string; options: UnitOptions; current: Current; distanceKm: number }) {
  const p = usePair(options, current);
  const reassign = Boolean(current.truckId);
  return (
    <ActionForm action={assignLoad.bind(null, loadId)} className="space-y-3">
      <Field label="Truck" required>
        <Select name="truckId" required value={p.truckId} onChange={(e) => p.onTruck(e.target.value)} placeholder="Select a truck…" options={opt(options.trucks)} />
      </Field>
      <Field label="Driver" required hint={p.driver ? `Pay ≈ ${money(distanceKm * p.driver.payPerKm)} at $${p.driver.payPerKm.toFixed(2)}/km` : undefined}>
        <Select name="driverId" required value={p.driverId} onChange={(e) => p.onDriver(e.target.value)} placeholder="Select a driver…" options={opt(options.drivers)} />
      </Field>
      <Field label="Trailer">
        <Select name="trailerId" defaultValue={current.trailerId ?? ""} placeholder="No trailer" options={opt(options.trailers)} />
      </Field>
      {p.warnings.length > 0 && <p className="text-[11px] text-warn">{p.warnings.join(" · ")} — units committed elsewhere are rejected on save.</p>}
      <SubmitButton className="w-full" pendingText="Assigning…">{reassign ? "Reassign" : "Assign & dispatch"}</SubmitButton>
      <p className="text-[11px] text-fg-subtle">Moves the load to Dispatched, sets driver pay from the driver’s rate and notifies the driver.</p>
    </ActionForm>
  );
}

/** Move a dispatched / in-transit load to another unit without losing stop progress (recoverLoad). */
export function RecoverForm({ loadId, options, current }: { loadId: string; options: UnitOptions; current: Current }) {
  const p = usePair(options, { truckId: null, driverId: null, trailerId: null });
  return (
    <ActionForm action={recoverLoad.bind(null, loadId)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="New truck" required>
          <Select name="truckId" required value={p.truckId} onChange={(e) => p.onTruck(e.target.value)} placeholder="Truck…" options={opt(options.trucks.filter((t) => t.id !== current.truckId))} />
        </Field>
        <Field label="New driver" required>
          <Select name="driverId" required value={p.driverId} onChange={(e) => p.onDriver(e.target.value)} placeholder="Driver…" options={opt(options.drivers.filter((d) => d.id !== current.driverId))} />
        </Field>
      </div>
      <Field label="Trailer" hint="Leave empty to keep the current trailer with the load.">
        <Select name="trailerId" defaultValue="" placeholder="Keep current trailer" options={opt(options.trailers.filter((t) => t.id !== current.trailerId))} />
      </Field>
      <Field label="Reason">
        <Input name="reason" maxLength={200} placeholder="Breakdown, hours of service, swap at the yard…" />
      </Field>
      {p.warnings.length > 0 && <p className="text-[11px] text-warn">{p.warnings.join(" · ")} — units committed elsewhere are rejected on save.</p>}
      <SubmitButton variant="secondary" className="w-full" pendingText="Moving…">Move load to this unit</SubmitButton>
      <p className="text-[11px] text-fg-subtle">Status and stop progress are kept; the previous unit is released and both drivers’ board statuses update.</p>
    </ActionForm>
  );
}
