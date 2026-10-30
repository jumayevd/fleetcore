"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import type { Truck } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { useFormat } from "@/components/locale";
import { Card, Field, InfoTip, Input, LinkButton, Progress, Select, Textarea, cn } from "@/components/ui";
import { CITIES, OWNERSHIP, OWNERSHIP_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/action";
import { serviceStatus } from "@/lib/service";
import { FUEL_TYPES, intervalText, leaseStatus, NEW_TRUCK_STATUSES, serviceSummary, truckStatusLabel, TRUCK_STATUS_LABELS } from "./lib";

type NumKey = "odometerKm" | "pmIntervalKm" | "lastPmKm" | "nextServiceKm" | "leaseStartKm" | "leaseAnnualLimitKm" | "leaseBufferPct" | "leaseOverageRate";
export type TruckTypeOption = { id: string; name: string; oilIntervalKm: number };

const num = (v: string) => (v.trim() === "" ? null : Number(v));
/** The preview treats the odometer as just read (a fixed instant keeps rendering pure). */
const PREVIEW_AT = new Date(0);

/** Add / edit a truck. Every distance is in the company's unit (labels from the formatter); saving opens the truck page. */
export function TruckForm({ action, truck, drivers, groups, types, cancelHref }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  truck?: Truck | null;
  drivers: { id: string; name: string }[];
  groups: string[];
  types: TruckTypeOption[];
  cancelHref: string;
}) {
  const f = useFormat();
  const d = f.labels.distance;
  const [ownership, setOwnership] = useState(truck?.ownership ?? "COMPANY");
  const [typeId, setTypeId] = useState(truck?.truckTypeId ?? "");
  const [v, setV] = useState<Record<NumKey, string>>({
    odometerKm: String(truck?.odometerKm ?? 0),
    pmIntervalKm: String(truck?.pmIntervalKm ?? (f.imperial ? 15000 : 30000)),
    lastPmKm: truck?.lastPmKm?.toString() ?? "",
    nextServiceKm: truck?.nextServiceKm?.toString() ?? "",
    leaseStartKm: truck?.leaseStartKm?.toString() ?? "",
    leaseAnnualLimitKm: truck?.leaseAnnualLimitKm?.toString() ?? "",
    leaseBufferPct: truck?.leaseBufferPct?.toString() ?? "",
    leaseOverageRate: truck?.leaseOverageRate?.toString() ?? "",
  });
  const set = (k: NumKey) => (e: ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const type = types.find((t) => t.id === typeId) ?? null;
  const odo = num(v.odometerKm) ?? 0;
  const s = serviceStatus({
    odometerKm: odo, odometerAt: PREVIEW_AT, pmIntervalKm: num(v.pmIntervalKm) ?? 0, lastPmKm: num(v.lastPmKm), nextServiceKm: num(v.nextServiceKm),
    truckType: type,
  }, PREVIEW_AT);
  const svc = serviceSummary(s, f, null);
  const lease = leaseStatus({
    ownership, odometerKm: odo, lessor: null,
    leaseStartKm: num(v.leaseStartKm), leaseAnnualLimitKm: num(v.leaseAnnualLimitKm), leaseBufferPct: num(v.leaseBufferPct), leaseOverageRate: num(v.leaseOverageRate),
  });
  const isLeased = ownership === "LEASED";
  const tone = (t: string) => (t === "danger" ? "text-danger" : t === "warn" ? "text-warn" : t === "ok" ? "text-ok" : "text-fg");

  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card id="identity" className="scroll-mt-20" title="Identity">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Unit number" required><Input name="unitNumber" required defaultValue={truck?.unitNumber} placeholder="T-120" className="num" /></Field>
              <Field label="Plate" required><Input name="plate" required defaultValue={truck?.plate} placeholder="Plate number" className="num uppercase" /></Field>
              <Field label="VIN"><Input name="vin" defaultValue={truck?.vin ?? ""} placeholder="17 characters" className="num uppercase" maxLength={17} /></Field>
              <Field label="Make" required><Input name="make" required defaultValue={truck?.make} placeholder="Freightliner" /></Field>
              <Field label="Model" required><Input name="model" required defaultValue={truck?.model} placeholder="Cascadia" /></Field>
              <Field label="Year"><Input name="year" type="number" min={1990} max={2100} defaultValue={truck?.year ?? new Date().getFullYear()} className="num" /></Field>
              <Field label="Colour"><Input name="color" defaultValue={truck?.color ?? ""} placeholder="White" /></Field>
              <Field label="In service since" hint="The day the truck started working for you.">
                <Input name="inServiceAt" type="date" defaultValue={f.dateInput(truck?.inServiceAt)} />
              </Field>
              {truck ? (
                <Field label="Status" hint="Change it from the status menu at the top of the truck page: In shop opens a repair order, Inactive asks why.">
                  <Input value={truckStatusLabel(truck.status, Boolean(truck.driverId))} readOnly disabled />
                </Field>
              ) : (
                <Field label="Status" hint="In service shows as Available, or Assigned once it has a driver. Vendor: another company's or owner's truck (not leased).">
                  <Select name="status" defaultValue="ACTIVE" options={NEW_TRUCK_STATUSES.map((st) => ({ value: st, label: st === "ACTIVE" ? "In service (Available / Assigned)" : TRUCK_STATUS_LABELS[st] }))} />
                </Field>
              )}
              <Field label="Home terminal" hint="Where the truck is based.">
                <Input name="homeTerminal" list="truck-terminals" defaultValue={truck?.homeTerminal ?? ""} placeholder="Joliet, IL" />
                <datalist id="truck-terminals">{[...new Set([...groups, ...CITIES.map((c) => c.name)])].map((g) => <option key={g} value={g} />)}</datalist>
              </Field>
              <Field label="Group" hint="Fleet or team label used for filtering.">
                <Input name="group" list="truck-groups" defaultValue={truck?.group ?? ""} placeholder="Regional" />
                <datalist id="truck-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
              </Field>
              <div id="driver" className="scroll-mt-20">
                <Field label="Assigned driver" hint={drivers.length || truck?.driverId
                  ? "Active drivers without a truck."
                  : <>No active driver without a truck. <Link href="/drivers/new" className="font-medium text-fg hover:underline">Add a driver</Link></>}>
                  <Select name="driverId" defaultValue={truck?.driverId ?? ""} placeholder="No driver" options={drivers.map((x) => ({ value: x.id, label: x.name }))} />
                </Field>
              </div>
              {!truck && (
                <Field label="Current location" hint="Optional. A known city puts the truck on the map.">
                  <Input name="locationName" list="truck-cities" placeholder="Joliet, IL" />
                  <datalist id="truck-cities">{CITIES.map((c) => <option key={c.name} value={c.name} />)}</datalist>
                </Field>
              )}
            </div>
          </Card>

          <Card id="service" className="scroll-mt-20" title={<span className="flex items-center gap-1.5">Odometer &amp; oil service<InfoTip>The truck type sets the oil interval for every truck of that type. Without a type, the truck&apos;s own interval below applies.</InfoTip></span>}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Truck type" hint={type ? `Oil every ${f.dist(type.oilIntervalKm)}, from the type.` : types.length ? "No type: the truck's own interval applies." : <>No truck types yet. Set them up on <Link href="/maintenance/oil" className="font-medium text-fg hover:underline">Oil changes</Link>.</>}>
                <Select name="truckTypeId" value={typeId} onChange={(e) => setTypeId(e.target.value)} placeholder="No type"
                  options={types.map((t) => ({ value: t.id, label: `${t.name} · ${f.dist(t.oilIntervalKm)}` }))} />
              </Field>
              <Field label={`Own oil interval (${d})`} hint={type ? `Not used while the truck is a ${type.name}.` : "Used while the truck has no type."}>
                <Input name="pmIntervalKm" type="number" min={500} step={500} value={v.pmIntervalKm} onChange={set("pmIntervalKm")} className={cn("num", type && "text-fg-subtle")} />
              </Field>
              <Field label={`Odometer (${d})`} hint={truck ? "Corrects the record. Day-to-day readings go in Update readings on the truck page." : undefined}>
                <Input name="odometerKm" type="number" min={0} value={v.odometerKm} onChange={set("odometerKm")} className="num" />
              </Field>
              <Field label={`Last oil change at (${d})`}><Input name="lastPmKm" type="number" min={0} value={v.lastPmKm} onChange={set("lastPmKm")} className="num" /></Field>
              <Field label="Last oil change date"><Input name="lastPmAt" type="date" defaultValue={f.dateInput(truck?.lastPmAt)} /></Field>
              <Field label={`Next oil change at (${d})`} hint="Only used when no last oil change is recorded.">
                <Input name="nextServiceKm" type="number" min={0} value={v.nextServiceKm} onChange={set("nextServiceKm")} className="num" />
              </Field>
              <div className="rounded-md border border-line bg-raised px-3 py-2 sm:col-span-2 lg:col-span-1">
                <p className="eyebrow">Service outlook</p>
                <p className={cn("num mt-1 text-[15px] font-semibold", tone(svc.tone))}>{s.state === "unknown" ? "—" : svc.text}</p>
                <p className="mt-0.5 text-[11px] text-fg-subtle">{s.state === "unknown" ? "Enter the last oil change to start the countdown." : intervalText(s, f)}</p>
                {s.pct != null && <Progress value={s.pct} tone={svc.tone === "neutral" ? "progress" : svc.tone} className="mt-2" />}
              </div>
              <Field label="Engine hours"><Input name="engineHours" type="number" min={0} step={1} defaultValue={truck?.engineHours ?? ""} className="num" /></Field>
              <Field label="Fuel type"><Select name="fuelType" defaultValue={truck?.fuelType ?? "DIESEL"} options={FUEL_TYPES} /></Field>
              <Field label={`Tank capacity (${f.labels.volume})`}><Input name="fuelCapacityL" type="number" min={0} defaultValue={truck?.fuelCapacityL ?? (f.imperial ? 150 : 600)} className="num" /></Field>
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
                  <Field label="Lessor"><Input name="lessor" defaultValue={truck?.lessor ?? ""} placeholder="Leasing company" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={`Lease start (${d})`}><Input name="leaseStartKm" type="number" min={0} value={v.leaseStartKm} onChange={set("leaseStartKm")} className="num" /></Field>
                    <Field label={`Annual limit (${d})`}><Input name="leaseAnnualLimitKm" type="number" min={0} step={1000} value={v.leaseAnnualLimitKm} onChange={set("leaseAnnualLimitKm")} className="num" /></Field>
                    <Field label="Buffer (%)"><Input name="leaseBufferPct" type="number" min={0} max={100} step={0.5} value={v.leaseBufferPct} onChange={set("leaseBufferPct")} className="num" /></Field>
                    <Field label={`Overage (${f.currency} ${f.labels.perDistance})`}><Input name="leaseOverageRate" type="number" min={0} step={0.01} value={v.leaseOverageRate} onChange={set("leaseOverageRate")} className="num" /></Field>
                  </div>
                  <div className="rounded-md border border-line bg-raised px-3 py-2">
                    <p className="eyebrow">Cap preview</p>
                    {lease ? (
                      <>
                        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                          <dt className="text-fg-subtle">Allowed</dt><dd className="num text-right text-fg">{f.dist(lease.allowedKm)}</dd>
                          <dt className="text-fg-subtle">Hard cap</dt><dd className="num text-right text-fg">{f.dist(lease.hardCapKm)}</dd>
                          <dt className="text-fg-subtle">{lease.overKm > 0 ? "Over cap" : "Remaining"}</dt>
                          <dd className={cn("num text-right font-medium", tone(lease.tone))}>{f.dist(lease.overKm > 0 ? lease.overKm : lease.remainingKm)}</dd>
                          {lease.exposure > 0 && <><dt className="text-fg-subtle">Exposure</dt><dd className="num text-right font-medium text-danger">{f.money(lease.exposure)}</dd></>}
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

          <Card title="Paperwork dates">
            <div className="space-y-4">
              <Field label="Registration expiry"><Input name="registrationExpiry" type="date" defaultValue={f.dateInput(truck?.registrationExpiry)} /></Field>
              <Field label="Annual inspection due"><Input name="inspectionExpiry" type="date" defaultValue={f.dateInput(truck?.inspectionExpiry)} /></Field>
              <Field label="Insurance expiry"><Input name="insuranceExpiry" type="date" defaultValue={f.dateInput(truck?.insuranceExpiry)} /></Field>
              <p className="text-[11px] text-fg-subtle">Upload the papers themselves on the Documents tab of the truck page; their dates update these.</p>
            </div>
          </Card>

          <Card title="Notes">
            <Textarea name="notes" rows={4} defaultValue={truck?.notes ?? ""} placeholder="Known issues, tire brand, toll tag number…" />
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
