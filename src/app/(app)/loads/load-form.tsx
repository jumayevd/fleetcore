"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Lock, Sparkles } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Checkbox, Field, Input, LinkButton, Select, Textarea, cn } from "@/components/ui";
import { EQUIPMENT, EQUIPMENT_LABELS, LOAD_STATUS_LABELS, PRIORITIES, type LoadStatus } from "@/lib/constants";
import { routeKm } from "@/lib/geo";
import { money, number } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import type { AssignmentOptions } from "./options";
import { fmtRpk, optLabel, ratePerKm, suggestedRate } from "./shared";
import { StopsEditor, newStop, stopCoords, toDraft, type StopDefault, type StopDraft } from "./stops-editor";

export type LoadDefaults = Partial<{
  status: string; customerId: string | null; brokerId: string | null; customerRef: string | null; teamId: string | null; priority: string;
  distanceKm: number | null; emptyKm: number | null; commodity: string; weightKg: number | null; pallets: number | null; equipment: string;
  temperatureC: number | null; hazmat: boolean; rate: number | null; driverPay: number | null; fuelCost: number | null; otherCost: number | null;
  notes: string | null; truckId: string | null; driverId: string | null; trailerId: string | null;
}>;

const FUEL_PER_KM = 0.3;
const s = (v: string | number | boolean | null | undefined) => (v == null ? "" : String(v));

/**
 * Multi-stop booking form. Distance, driver pay, fuel and the market rate are estimated live from the
 * stops and the chosen driver; every estimate is editable and blank fields fall back to the server's defaults.
 */
export function LoadForm({ action, options, defaults = {}, stops: initialStops, locked = false, submitLabel = "Create load", cancelHref = "/loads" }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  options: AssignmentOptions;
  defaults?: LoadDefaults;
  stops?: StopDefault[];
  /** In transit or later: stops and the unit can't change here (use Arrive / Complete and Recover on the load). */
  locked?: boolean;
  submitLabel?: string;
  cancelHref?: string;
}) {
  const [stops, setStops] = useState<StopDraft[]>(() =>
    initialStops && initialStops.length > 0
      ? initialStops.map(toDraft)
      : [newStop("PICKUP", { city: "Tashkent" }), newStop("DELIVERY", { city: "Samarkand" })],
  );
  const [equipment, setEquipment] = useState(defaults.equipment ?? "DRY_VAN");
  const [rate, setRate] = useState(s(defaults.rate));
  const [distance, setDistance] = useState(s(defaults.distanceKm));
  const [emptyKm, setEmptyKm] = useState(s(defaults.emptyKm ?? ""));
  const [driverPay, setDriverPay] = useState(s(defaults.driverPay));
  const [fuel, setFuel] = useState(s(defaults.fuelCost));
  const [other, setOther] = useState(s(defaults.otherCost));
  const [truckId, setTruckId] = useState(s(defaults.truckId));
  const [driverId, setDriverId] = useState(s(defaults.driverId));
  const [trailerId, setTrailerId] = useState(s(defaults.trailerId));
  const [teamId, setTeamId] = useState(s(defaults.teamId));

  const points = useMemo(() => stops.map(stopCoords), [stops]);
  const known = points.filter((p): p is NonNullable<typeof p> => p != null);
  const estimate = known.length >= 2 ? routeKm(known) : null;
  const estimateComplete = estimate != null && known.length === points.length;

  const dist = Number(distance) > 0 ? Number(distance) : estimate ?? 0;
  const emptyN = Math.max(0, Number(emptyKm) || 0);
  const rateN = Math.max(0, Number(rate) || 0);
  const driver = options.drivers.find((d) => d.id === driverId);
  const driverPayN = driverPay !== "" ? Number(driverPay) || 0 : driver ? Math.round(dist * driver.payPerKm) : 0;
  const fuelN = fuel !== "" ? Number(fuel) || 0 : Math.round(dist * FUEL_PER_KM);
  const otherN = Number(other) || 0;
  const margin = rateN - driverPayN - fuelN - otherN;
  const marginPct = rateN ? Math.round((margin / rateN) * 100) : null;
  const suggest = suggestedRate(dist);
  const rpk = ratePerKm(rateN, dist, emptyN);
  const pickups = stops.filter((x) => x.type === "PICKUP").length;
  const deliveries = stops.length - pickups;

  const onTruck = (id: string) => {
    setTruckId(id);
    const t = options.trucks.find((x) => x.id === id);
    if (t?.pairedDriverId && !driverId) setDriverId(t.pairedDriverId);
  };
  const onDriver = (id: string) => {
    setDriverId(id);
    const d = options.drivers.find((x) => x.id === id);
    if (d?.pairedTruckId && !truckId) setTruckId(d.pairedTruckId);
    if (d?.teamId && !teamId) setTeamId(d.teamId);
  };
  const opt = (xs: { id: string; label: string; note?: string }[]) => xs.map((x) => ({ value: x.id, label: optLabel(x) }));
  const status = defaults.status as LoadStatus | undefined;
  // A dispatched load keeps a truck and a driver: clearing them here would leave it "Dispatched" with no unit.
  // Returning it to Booked is the Unassign button in the load's Status card (releases the unit and trailer too).
  const dispatched = status === "ASSIGNED";
  const rateId = useId();
  const distanceId = useId();

  return (
    <ActionForm action={action} className="space-y-4">
      {locked && (
        <p className="flex items-start gap-2 rounded-md border border-line bg-sunken/60 px-3 py-2 text-[12px] text-fg-muted">
          <Lock className="mt-px h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span>
            This load is <b className="font-medium text-fg">{status ? LOAD_STATUS_LABELS[status] : "in progress"}</b>, so its stops and unit are locked here.
            Mark stops arrived or complete on the load page, and use <b className="font-medium text-fg">Recover</b> to move it to another truck. Cargo, pricing and references can still be edited.
          </span>
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Customer & commercial">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Customer" required className="lg:col-span-2">
                <Select name="customerId" required defaultValue={s(defaults.customerId)} placeholder="Select the shipper…" options={opt(options.customers)} />
              </Field>
              <Field label="Broker" hint="Who pays when the load came through a broker." className="lg:col-span-2">
                <Select name="brokerId" defaultValue={s(defaults.brokerId)} placeholder="Direct — no broker" options={opt(options.brokers)} />
              </Field>
              <Field label="Customer reference" hint="Their PO or booking number."><Input name="customerRef" defaultValue={s(defaults.customerRef)} placeholder="PO-48213" className="num" /></Field>
              <Field label="Team">
                <Select name="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="Follows the driver" options={options.teams.map((t) => ({ value: t.id, label: t.name }))} />
              </Field>
              <Field label="Priority">
                <Select name="priority" defaultValue={defaults.priority ?? "NORMAL"} options={PRIORITIES.map((p) => ({ value: p, label: p === "NORMAL" ? "Normal" : p === "LOW" ? "Low" : p === "HIGH" ? "High" : "Urgent" }))} />
              </Field>
            </div>
          </Card>

          <Card title="Stops" flush actions={
            <span className="num text-[11px] text-fg-subtle">
              {pickups} pickup{pickups === 1 ? "" : "s"} · {deliveries} deliver{deliveries === 1 ? "y" : "ies"}{estimate != null && ` · ≈ ${number(estimate)} km`}
            </span>
          }>
            <StopsEditor stops={stops} onChange={setStops} locked={locked} />
          </Card>

          <Card title="Cargo">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Commodity" required className="lg:col-span-2"><Input name="commodity" required defaultValue={s(defaults.commodity)} placeholder="Cotton yarn, beverages, machinery…" /></Field>
              <Field label="Equipment">
                <Select name="equipment" value={equipment} onChange={(e) => setEquipment(e.target.value)} options={EQUIPMENT.map((e) => ({ value: e, label: EQUIPMENT_LABELS[e] }))} />
              </Field>
              {equipment === "REEFER" ? (
                <Field label="Temperature (°C)" required><Input type="number" name="temperatureC" step="0.5" required defaultValue={s(defaults.temperatureC)} placeholder="-18" className="num" /></Field>
              ) : <div className="hidden lg:block" />}
              <Field label="Weight (kg)"><Input type="number" name="weightKg" min={0} step={10} defaultValue={s(defaults.weightKg)} placeholder="0" className="num" /></Field>
              <Field label="Pallets"><Input type="number" name="pallets" min={0} defaultValue={s(defaults.pallets)} placeholder="—" className="num" /></Field>
              <div className="flex items-end pb-1.5 lg:col-span-2">
                <Checkbox name="hazmat" defaultChecked={Boolean(defaults.hazmat)} label={<span>Hazardous materials <span className="text-fg-subtle">(ADR paperwork required)</span></span>} />
              </div>
              <Field label="Notes and instructions" className="sm:col-span-2 lg:col-span-4">
                <Textarea name="notes" defaultValue={s(defaults.notes)} placeholder="Dock number, contact on site, customs documents, seal requirements…" />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Pricing">
            <div className="space-y-3">
              <InlineField id={rateId} label="Customer rate (USD)" required hint={suggest ? <>Lane guide ≈ {money(suggest)} for {number(dist)} km</> : "Add two stops to see a lane guide."}
                action={suggest != null && Number(rate) !== suggest && (
                  <button type="button" onClick={() => setRate(String(suggest))} title="Use the lane guide" aria-label={`Use the lane guide rate, ${money(suggest)}`}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-accent-text hover:bg-accent-soft">
                    <Sparkles className="h-3.5 w-3.5" />Use
                  </button>
                )}>
                <Input id={rateId} type="number" name="rate" required min={0} step={10} value={rate} onChange={(e) => setRate(e.target.value)} placeholder={suggest ? String(suggest) : "0"} className="num" />
              </InlineField>
              <div className="grid grid-cols-2 gap-3">
                <InlineField id={distanceId} label="Loaded km" hint={estimate != null ? `Estimate ${number(estimate)} km${estimateComplete ? "" : " (partial)"}` : "Estimated from the stops"}
                  action={estimate != null && distance !== "" && Number(distance) !== estimate && (
                    <button type="button" onClick={() => setDistance("")} title="Use the estimate" aria-label={`Reset loaded km to the estimate, ${number(estimate)} km`}
                      className="inline-flex h-8 shrink-0 items-center rounded-md border border-line px-2 text-[12px] font-medium text-fg-muted hover:bg-raised">Reset</button>
                  )}>
                  <Input id={distanceId} type="number" name="distanceKm" min={1} step={1} value={distance} onChange={(e) => setDistance(e.target.value)} placeholder={estimate != null ? String(estimate) : "—"} className="num" />
                </InlineField>
                <Field label="Empty km" hint="Repositioning to the pickup.">
                  <Input type="number" name="emptyKm" min={0} step={1} value={emptyKm} onChange={(e) => setEmptyKm(e.target.value)} placeholder="0" className="num" />
                </Field>
                <Field label="Driver pay" hint={driver ? `${driver.label.split(" ")[0]} · $${driver.payPerKm.toFixed(2)}/km` : "Auto from the driver's rate"}>
                  <Input type="number" name="driverPay" min={0} value={driverPay} onChange={(e) => setDriverPay(e.target.value)} placeholder={String(driverPayN)} className="num" />
                </Field>
                <Field label="Fuel estimate" hint={`≈ $${FUEL_PER_KM.toFixed(2)} per loaded km`}>
                  <Input type="number" name="fuelCost" min={0} value={fuel} onChange={(e) => setFuel(e.target.value)} placeholder={String(fuelN)} className="num" />
                </Field>
                <Field label="Other costs" hint="Tolls, permits, lumper." className="col-span-2">
                  <Input type="number" name="otherCost" min={0} value={other} onChange={(e) => setOther(e.target.value)} placeholder="0" className="num" />
                </Field>
              </div>
              <dl className="grid grid-cols-3 gap-2 rounded-md bg-sunken/60 px-3 py-2">
                <div><dt className="text-[11px] text-fg-subtle">Rate per km</dt><dd className="num text-[13px] font-medium text-fg">{fmtRpk(rpk)}</dd></div>
                <div><dt className="text-[11px] text-fg-subtle">Costs</dt><dd className="num text-[13px] font-medium text-fg">{money(driverPayN + fuelN + otherN)}</dd></div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">Margin</dt>
                  <dd className={cn("num text-[13px] font-medium", rateN === 0 ? "text-fg-faint" : margin < 0 ? "text-danger" : marginPct != null && marginPct < 15 ? "text-warn" : "text-ok")}>
                    {rateN ? <>{money(margin)} <span className="text-[11px] font-normal">({marginPct}%)</span></> : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card title={locked || dispatched ? "Assignment" : "Assignment (optional)"}>
            {locked ? (
              <div className="space-y-2 text-[13px]">
                <Row k="Truck" v={options.trucks.find((t) => t.id === truckId)?.label ?? "—"} />
                <Row k="Driver" v={options.drivers.find((d) => d.id === driverId)?.label ?? "—"} />
                <Row k="Trailer" v={options.trailers.find((t) => t.id === trailerId)?.label ?? "—"} />
                <p className="text-[11px] text-fg-subtle">Use Recover on the load page to move an in-progress load to another unit.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Truck" required={dispatched}>
                  <Select name="truckId" required={dispatched} value={truckId} onChange={(e) => onTruck(e.target.value)} placeholder={dispatched ? "Select a truck…" : "Assign later"} options={opt(options.trucks)} />
                </Field>
                <Field label="Driver" required={dispatched} hint={driver?.note ? `${driver.label} is ${driver.note} — the server will reject this assignment.` : undefined}>
                  <Select name="driverId" required={dispatched} value={driverId} onChange={(e) => onDriver(e.target.value)} placeholder={dispatched ? "Select a driver…" : "Assign later"} options={opt(options.drivers)} />
                </Field>
                <Field label="Trailer"><Select name="trailerId" value={trailerId} onChange={(e) => setTrailerId(e.target.value)} placeholder="None" options={opt(options.trailers)} /></Field>
                <p className="text-[11px] text-fg-subtle">
                  {dispatched
                    ? <>This load is dispatched, so it keeps a truck and a driver; changing them reassigns it. To return it to Booked, use <b className="font-medium text-fg-muted">Unassign</b> in the Status card on the load page.</>
                    : "Choosing a truck and driver moves the load to Dispatched and notifies the driver."}
                  {" "}Units marked “busy” are already committed to another active load.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="num text-[12px] text-fg-muted">
          {stops.length} stops · {number(dist)} km loaded{emptyN ? ` + ${number(emptyN)} empty` : ""} · {money(rateN)} · {fmtRpk(rpk)} per km
          {rateN > 0 && <> · margin <span className={margin < 0 ? "text-danger" : "text-fg"}>{money(margin)}</span></>}
        </p>
        <div className="flex items-center gap-2">
          <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
          <SubmitButton pendingText="Saving load…">{submitLabel}</SubmitButton>
        </div>
      </footer>
    </ActionForm>
  );
}

/** Field whose control sits next to a helper button: the label points at the input instead of wrapping both. */
function InlineField({ id, label, required, hint, action, children }: {
  id: string; label: string; required?: boolean; hint?: ReactNode; action?: ReactNode; children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-fg-muted">{label}{required && <span className="text-danger"> *</span>}</label>
      <div className="flex gap-1.5">{children}{action}</div>
      {hint && <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-fg-subtle">{k}</span>
      <span className="truncate text-right font-medium text-fg">{v}</span>
    </div>
  );
}
