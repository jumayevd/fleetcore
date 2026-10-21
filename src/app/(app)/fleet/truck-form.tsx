"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import type { Truck } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, LinkButton, Progress, Select, Textarea } from "@/components/ui";
import { CITIES, OWNERSHIP, OWNERSHIP_LABELS, TRUCK_STATUSES } from "@/lib/constants";
import { number, toDateInput } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { FUEL_TYPES, leaseStatus, pmStatus, TRUCK_STATUS_LABELS } from "./lib";

type NumKey = "odometerKm" | "pmIntervalKm" | "lastPmKm" | "nextServiceKm" | "leaseStartKm" | "leaseAnnualLimitKm" | "leaseBufferPct" | "leaseOverageRate";

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function TruckForm({ action, truck, drivers, groups, cancelHref }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  truck?: Truck | null;
  drivers: { id: string; name: string }[];
  groups: string[];
  cancelHref: string;
}) {
  const [ownership, setOwnership] = useState(truck?.ownership ?? "COMPANY");
  const [v, setV] = useState<Record<NumKey, string>>({
    odometerKm: String(truck?.odometerKm ?? 0),
    pmIntervalKm: String(truck?.pmIntervalKm ?? 30000),
    lastPmKm: truck?.lastPmKm?.toString() ?? "",
    nextServiceKm: truck?.nextServiceKm?.toString() ?? "",
    leaseStartKm: truck?.leaseStartKm?.toString() ?? "",
    leaseAnnualLimitKm: truck?.leaseAnnualLimitKm?.toString() ?? "",
    leaseBufferPct: truck?.leaseBufferPct?.toString() ?? "",
    leaseOverageRate: truck?.leaseOverageRate?.toString() ?? "",
  });
  const set = (k: NumKey) => (e: ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const odo = num(v.odometerKm) ?? 0;
  const pm = pmStatus({ odometerKm: odo, pmIntervalKm: num(v.pmIntervalKm) ?? 30000, lastPmKm: num(v.lastPmKm), nextServiceKm: num(v.nextServiceKm) });
  const lease = leaseStatus({
    ownership, odometerKm: odo, lessor: null,
    leaseStartKm: num(v.leaseStartKm), leaseAnnualLimitKm: num(v.leaseAnnualLimitKm), leaseBufferPct: num(v.leaseBufferPct), leaseOverageRate: num(v.leaseOverageRate),
  });
  const isLeased = ownership === "LEASED";

  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Identity">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Unit number" required><Input name="unitNumber" required defaultValue={truck?.unitNumber} placeholder="T-120" className="num" /></Field>
              <Field label="Plate" required><Input name="plate" required defaultValue={truck?.plate} placeholder="01 A 123 AA" className="num" /></Field>
              <Field label="VIN"><Input name="vin" defaultValue={truck?.vin ?? ""} placeholder="17 characters" className="num" maxLength={17} /></Field>
              <Field label="Make" required><Input name="make" required defaultValue={truck?.make} placeholder="Volvo" /></Field>
              <Field label="Model" required><Input name="model" required defaultValue={truck?.model} placeholder="FH 500" /></Field>
              <Field label="Year"><Input name="year" type="number" min={1990} max={2100} defaultValue={truck?.year ?? new Date().getFullYear()} className="num" /></Field>
              <Field label="Status" hint="Starting a work order moves the truck to In shop; finishing it brings it back.">
                <Select name="status" defaultValue={truck?.status ?? "ACTIVE"} options={TRUCK_STATUSES.map((s) => ({ value: s, label: TRUCK_STATUS_LABELS[s] }))} />
              </Field>
              <Field label="Group" hint="Depot, terminal or fleet label used for filtering.">
                <Input name="group" list="truck-groups" defaultValue={truck?.group ?? ""} placeholder="Tashkent depot" />
                <datalist id="truck-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
              </Field>
              <Field label="Assigned driver" hint={drivers.length || truck?.driverId
                ? "Active drivers without a truck."
                : <>No active driver without a truck. <Link href="/drivers/new" className="font-medium text-fg hover:underline">Add a driver</Link></>}>
                <Select name="driverId" defaultValue={truck?.driverId ?? ""} placeholder="No driver" options={drivers.map((d) => ({ value: d.id, label: d.name }))} />
              </Field>
              {!truck && (
                <Field label="Current location" hint="Optional. A known city puts the truck on the map.">
                  <Input name="locationName" list="truck-cities" placeholder="Tashkent" />
                  <datalist id="truck-cities">{CITIES.map((c) => <option key={c.name} value={c.name} />)}</datalist>
                </Field>
              )}
            </div>
          </Card>

          <Card title="Odometer & service">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Odometer (km)" hint={truck ? "Corrects the record. Day-to-day readings go in Update readings on the truck page." : undefined}>
                <Input name="odometerKm" type="number" min={0} value={v.odometerKm} onChange={set("odometerKm")} className="num" />
              </Field>
              <Field label="PM interval (km)"><Input name="pmIntervalKm" type="number" min={1000} step={1000} value={v.pmIntervalKm} onChange={set("pmIntervalKm")} className="num" /></Field>
              <Field label="Last PM at (km)"><Input name="lastPmKm" type="number" min={0} value={v.lastPmKm} onChange={set("lastPmKm")} className="num" /></Field>
              <Field label="Last PM date"><Input name="lastPmAt" type="date" defaultValue={toDateInput(truck?.lastPmAt)} /></Field>
              <Field label="Next service at (km)" hint="Leave empty to use last PM + interval.">
                <Input name="nextServiceKm" type="number" min={0} value={v.nextServiceKm} onChange={set("nextServiceKm")} placeholder={pm.next != null && v.nextServiceKm === "" ? String(pm.next) : ""} className="num" />
              </Field>
              <div className="rounded-md border border-line bg-raised px-3 py-2">
                <p className="eyebrow">Service outlook</p>
                {pm.left == null ? <p className="mt-1 text-[12px] text-fg-muted">Enter last PM km or a next service km to track PM.</p> : (
                  <>
                    <p className={`num mt-1 text-[15px] font-semibold ${pm.state === "overdue" ? "text-danger" : pm.state === "due" ? "text-warn" : "text-fg"}`}>
                      {pm.left < 0 ? `${number(-pm.left)} km overdue` : `${number(pm.left)} km left`}
                    </p>
                    <Progress value={pm.pct ?? 0} tone={pm.tone} className="mt-2" />
                  </>
                )}
              </div>
              <Field label="Fuel type"><Select name="fuelType" defaultValue={truck?.fuelType ?? "DIESEL"} options={FUEL_TYPES} /></Field>
              <Field label="Tank capacity (L)"><Input name="fuelCapacityL" type="number" min={0} defaultValue={truck?.fuelCapacityL ?? 600} className="num" /></Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Ownership & lease">
            <div className="space-y-4">
              <Field label="Ownership">
                <Select name="ownership" value={ownership} onChange={(e) => setOwnership(e.target.value)} options={OWNERSHIP.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] }))} />
              </Field>
              {isLeased ? (
                <>
                  <Field label="Lessor"><Input name="lessor" defaultValue={truck?.lessor ?? ""} placeholder="UzAuto Leasing" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Lease start (km)"><Input name="leaseStartKm" type="number" min={0} value={v.leaseStartKm} onChange={set("leaseStartKm")} className="num" /></Field>
                    <Field label="Annual limit (km)"><Input name="leaseAnnualLimitKm" type="number" min={0} step={1000} value={v.leaseAnnualLimitKm} onChange={set("leaseAnnualLimitKm")} className="num" /></Field>
                    <Field label="Buffer (%)"><Input name="leaseBufferPct" type="number" min={0} max={100} step={0.5} value={v.leaseBufferPct} onChange={set("leaseBufferPct")} className="num" /></Field>
                    <Field label="Overage ($/km)"><Input name="leaseOverageRate" type="number" min={0} step={0.01} value={v.leaseOverageRate} onChange={set("leaseOverageRate")} className="num" /></Field>
                  </div>
                  <div className="rounded-md border border-line bg-raised px-3 py-2">
                    <p className="eyebrow">Cap preview</p>
                    {lease ? (
                      <>
                        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                          <dt className="text-fg-subtle">Allowed</dt><dd className="num text-right text-fg">{number(lease.allowedKm)} km</dd>
                          <dt className="text-fg-subtle">Hard cap</dt><dd className="num text-right text-fg">{number(lease.hardCapKm)} km</dd>
                          <dt className="text-fg-subtle">{lease.overKm > 0 ? "Over cap" : "Remaining"}</dt>
                          <dd className={`num text-right font-medium ${lease.tone === "danger" ? "text-danger" : lease.tone === "warn" ? "text-warn" : "text-ok"}`}>{number(lease.overKm > 0 ? lease.overKm : lease.remainingKm)} km</dd>
                          {lease.exposure > 0 && <><dt className="text-fg-subtle">Exposure</dt><dd className="num text-right font-medium text-danger">${number(Math.round(lease.exposure))}</dd></>}
                        </dl>
                        <Progress value={lease.pct} tone={lease.tone} marker={lease.allowedMarker} className="mt-2" />
                      </>
                    ) : <p className="mt-1 text-[12px] text-fg-muted">Enter the annual limit to see the cap.</p>}
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-fg-subtle">{ownership === "OWNER_OPERATOR" ? "Owner-operator units are tracked but not on the company's lease ledger." : "Company-owned. Switch to Leased to record the mileage cap."}</p>
              )}
            </div>
          </Card>

          <Card title="Compliance dates" >
            <div className="space-y-4">
              <Field label="Insurance expiry"><Input name="insuranceExpiry" type="date" defaultValue={toDateInput(truck?.insuranceExpiry)} /></Field>
              <Field label="Technical inspection expiry"><Input name="inspectionExpiry" type="date" defaultValue={toDateInput(truck?.inspectionExpiry)} /></Field>
              <Field label="Registration expiry"><Input name="registrationExpiry" type="date" defaultValue={toDateInput(truck?.registrationExpiry)} /></Field>
              <p className="text-[11px] text-fg-subtle">Upload the documents themselves on the Compliance tab of the truck page.</p>
            </div>
          </Card>

          <Card title="Notes">
            <Textarea name="notes" rows={4} defaultValue={truck?.notes ?? ""} placeholder="Known issues, tyre brand, tolls tag number…" />
          </Card>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
        <SubmitButton pendingText={truck ? "Saving…" : "Adding…"}>{truck ? "Save changes" : "Add truck"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
