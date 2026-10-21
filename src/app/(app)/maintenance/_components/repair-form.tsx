"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Container, Truck as TruckIcon } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, InfoTip, Input, Select, Textarea, buttonClass, cn, segmentedThumb, segmentedTrack } from "@/components/ui";
import { useFormat } from "@/components/locale";
import { PAYERS, PAYER_HINTS, PAYER_LABELS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, REPAIR_TYPES, REPAIR_TYPE_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/action";
import { LinesEditor } from "@/components/shop/lines-editor";
import { VendorPicker } from "@/components/shop/vendor-picker";
import { FORM_STATUSES, SYSTEM_FOR_TYPE, type LineValue, type VendorOption } from "@/components/shop/shared";
import type { UnitOption } from "../_lib/data";

type DateKey = "scheduledAt" | "inAt" | "outAt" | "promisedAt";

/**
 * Serialisable initial values. Dates are input strings in company time (scheduledAt / promisedAt as yyyy-MM-dd,
 * inAt / outAt as yyyy-MM-ddTHH:mm). `stamps` are the stored ISO timestamps: a date left alone is sent back exactly
 * as stored, so saving an unrelated change never rounds a time the buttons recorded.
 */
export type RepairFormValues = {
  truckId?: string | null; trailerId?: string | null;
  repairType?: string | null; title?: string | null; description?: string | null; technician?: string | null;
  status?: string | null;
  scheduledAt?: string | null; inAt?: string | null; outAt?: string | null; promisedAt?: string | null;
  stamps?: Partial<Record<DateKey, string | null>>;
  vendorId?: string | null; vendorName?: string | null;
  payer?: string | null; chargeDriverId?: string | null;
  lines?: LineValue[];
  invoiceTotal?: number | null; invoiceNumber?: string | null; paymentStatus?: string | null;
  odometerKm?: number | null; odometerOutKm?: number | null;
  /** A defect this repair fixes: saving ties the defect to it. */
  defectId?: string | null;
};

type Mode = "truck" | "trailer";
const numOrEmpty = (v: number | null | undefined) => (v == null ? "" : String(v));

/** Label with an (i) outside the <label>, so the control's accessible name stays the label. */
function TipField({ id, label, tip, hint, required, children, className }: {
  id: string; label: string; tip?: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1">
        <label htmlFor={id} className="text-[12px] font-medium text-fg-muted">{label}{required && <span className="text-danger"> *</span>}</label>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-subtle">{hint}</span>}
    </div>
  );
}

export function RepairForm({ action, trucks, trailers, drivers, vendors, initial = {}, savedStatus, money, now, submitLabel, cancelHref }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  trucks: UnitOption[];
  trailers: UnitOption[];
  drivers: { id: string; name: string }[];
  vendors: VendorOption[];
  initial?: RepairFormValues;
  /** Status stored on the order being edited; omit when creating one. */
  savedStatus?: string;
  /** The person can see costs and invoices. */
  money: boolean;
  /** Company time now as yyyy-MM-ddTHH:mm: fills the in / back dates when the status asks for them. */
  now: string;
  submitLabel: string;
  cancelHref: string;
}) {
  const f = useFormat();
  const uid = useId();
  const [mode, setMode] = useState<Mode>(initial.trailerId && !initial.truckId ? "trailer" : "truck");
  const [truckId, setTruckId] = useState(initial.truckId ?? "");
  const [trailerId, setTrailerId] = useState(initial.trailerId ?? "");
  const [repairType, setRepairType] = useState(initial.repairType ?? "REPAIR");
  const [status, setStatus] = useState(initial.status && initial.status !== "DRAFT" ? initial.status : "OPEN");
  const [payer, setPayer] = useState(initial.payer ?? "COMPANY");
  const [chargeDriverId, setChargeDriverId] = useState(initial.chargeDriverId ?? "");
  const [odometer, setOdometer] = useState(numOrEmpty(initial.odometerKm));
  const [odometerTouched, setOdometerTouched] = useState(initial.odometerKm != null);
  const [odometerOut, setOdometerOut] = useState(numOrEmpty(initial.odometerOutKm));
  const [linesTotal, setLinesTotal] = useState(0);
  const [invoice, setInvoice] = useState(numOrEmpty(initial.invoiceTotal));
  const [invoiceTouched, setInvoiceTouched] = useState(initial.invoiceTotal != null);
  const [paymentStatus, setPaymentStatus] = useState(initial.paymentStatus ?? "");
  const [dates, setDates] = useState<Record<DateKey, string>>({
    scheduledAt: initial.scheduledAt ?? "", inAt: initial.inAt ?? "", outAt: initial.outAt ?? "", promisedAt: initial.promisedAt ?? "",
  });

  const inShop = savedStatus === "IN_PROGRESS";
  const done = savedStatus === "DONE";
  const statusChoices = done ? FORM_STATUSES.filter((s) => s.value === "DONE") : inShop ? FORM_STATUSES.filter((s) => s.value !== "OPEN") : FORM_STATUSES;
  const truck = trucks.find((t) => t.id === truckId);
  const unit = mode === "truck" ? truck : trailers.find((t) => t.id === trailerId);
  const completed = status === "DONE";
  const shownInvoice = invoiceTouched ? invoice : linesTotal ? String(linesTotal) : "";

  const setDate = (k: DateKey, v: string) => setDates((d) => ({ ...d, [k]: v }));
  const submitted = (k: DateKey) => {
    const stamp = initial.stamps?.[k];
    return stamp && dates[k] === (initial[k] ?? "") ? stamp : dates[k];
  };
  const changeStatus = (next: string) => {
    setStatus(next);
    if ((next === "IN_PROGRESS" || next === "DONE") && !dates.inAt) setDate("inAt", now);
    if (next === "DONE" && !dates.outAt) setDate("outAt", now);
  };
  // The odometer follows the picked truck until someone types a reading.
  const pickTruck = (id: string) => {
    setTruckId(id);
    const t = trucks.find((x) => x.id === id);
    if (!odometerTouched) setOdometer(numOrEmpty(t?.odometerKm));
    if (payer === "DRIVER" && !chargeDriverId && t?.driverId) setChargeDriverId(t.driverId);
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    if (!odometerTouched) setOdometer(next === "truck" ? numOrEmpty(truck?.odometerKm) : "");
  };
  const pickPayer = (p: string) => {
    setPayer(p);
    if (p === "DRIVER" && !chargeDriverId && unit?.driverId) setChargeDriverId(unit.driverId);
  };

  const toggle = (next: Mode) => (
    <button type="button" onClick={() => switchMode(next)} aria-pressed={mode === next} className={segmentedThumb(mode === next)}>
      {next === "truck" ? <TruckIcon className="h-3.5 w-3.5" /> : <Container className="h-3.5 w-3.5" />}
      {next === "truck" ? "Truck" : "Trailer"}
    </button>
  );
  const dist = f.labels.distance;

  return (
    <ActionForm action={action} className="grid gap-4 xl:grid-cols-3">
      {savedStatus && <input type="hidden" name="savedStatus" value={savedStatus} />}
      {initial.defectId && <input type="hidden" name="defectId" value={initial.defectId} />}
      <div className="space-y-4 xl:col-span-2">
        <Card title="Unit and job" actions={!inShop && !done && <div className={segmentedTrack}>{toggle("truck")}{toggle("trailer")}</div>}>
          <div className="grid gap-4 sm:grid-cols-2">
            {inShop || done ? (
              <Field label={mode === "truck" ? "Truck" : "Trailer"} hint={inShop ? "In the shop on this repair. Complete or void it before moving the work to another unit." : undefined} className="sm:col-span-2">
                <Input readOnly value={unit ? `${unit.unitNumber} · ${unit.detail}` : "—"} className="bg-sunken text-fg-muted" />
                <input type="hidden" name={mode === "truck" ? "truckId" : "trailerId"} value={mode === "truck" ? truckId : trailerId} />
              </Field>
            ) : mode === "truck" ? (
              <Field label="Truck" required className="sm:col-span-2" hint={truck?.odometerKm != null ? `Odometer ${f.dist(truck.odometerKm)}` : undefined}>
                <Select name="truckId" required value={truckId} onChange={(e) => pickTruck(e.target.value)} placeholder="Pick a truck…"
                  options={trucks.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.detail}` }))} />
              </Field>
            ) : (
              <Field label="Trailer" required className="sm:col-span-2">
                <Select name="trailerId" required value={trailerId} onChange={(e) => setTrailerId(e.target.value)} placeholder="Pick a trailer…"
                  options={trailers.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.detail}` }))} />
              </Field>
            )}
            <TipField id={`${uid}-type`} label="Repair type" tip="Completing an oil change restarts the oil interval; an annual DOT inspection moves the inspection expiry a year on.">
              <Select id={`${uid}-type`} name="repairType" value={repairType} onChange={(e) => setRepairType(e.target.value)}
                options={REPAIR_TYPES.map((t) => ({ value: t, label: REPAIR_TYPE_LABELS[t] }))} />
            </TipField>
            <Field label="Title">
              <Input name="title" defaultValue={initial.title ?? ""} placeholder={REPAIR_TYPE_LABELS[repairType] ?? "e.g. Front brakes"} maxLength={200} />
            </Field>
            <Field label="Technician">
              <Input name="technician" defaultValue={initial.technician ?? ""} placeholder="Who is working on it" />
            </Field>
            <div className="hidden sm:block" />
            <Field label="Description" className="sm:col-span-2">
              <Textarea name="description" defaultValue={initial.description ?? ""} placeholder="Symptoms, what the driver reported, what the shop found" />
            </Field>
          </div>
        </Card>

        <Card title={completed ? <span>What was done <span className="text-danger">*</span></span> : "Work to do"}
          actions={<span className="text-[11px] text-fg-subtle">{completed ? "At least one line" : "Optional until it is completed"}</span>}>
          <LinesEditor initial={initial.lines} money={money} defaultSystem={SYSTEM_FOR_TYPE[repairType] ?? "OTHER"} onTotal={setLinesTotal} />
        </Card>

        <Card title="Who pays">
          <input type="hidden" name="payer" value={payer} />
          <div role="radiogroup" aria-label="Who pays" className="grid gap-2 sm:grid-cols-2">
            {PAYERS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={payer === p} onClick={() => pickPayer(p)}
                className={cn("rounded-[9px] border px-3 py-2 text-left transition-colors", payer === p ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-raised")}>
                <span className={cn("block text-[13px] font-medium", payer === p ? "text-accent-text" : "text-fg")}>{PAYER_LABELS[p]}</span>
                <span className="block text-[11px] text-fg-subtle">{PAYER_HINTS[p]}</span>
              </button>
            ))}
          </div>
          {payer === "DRIVER" && (
            <Field label="Driver" required className="mt-3 sm:max-w-sm" hint="The repair shows as “driver not told” until someone tells them.">
              <Select name="chargeDriverId" required value={chargeDriverId} onChange={(e) => setChargeDriverId(e.target.value)} placeholder="Pick the driver…"
                options={drivers.map((d) => ({ value: d.id, label: d.name }))} />
            </Field>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Status">
          <input type="hidden" name="status" value={status} />
          <div role="radiogroup" aria-label="Status" className="space-y-1.5">
            {statusChoices.map((s) => (
              <button key={s.value} type="button" role="radio" aria-checked={status === s.value} onClick={() => changeStatus(s.value)}
                className={cn("flex w-full items-start gap-2.5 rounded-[9px] border px-3 py-2 text-left transition-colors", status === s.value ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-raised")}>
                <span className={cn("mt-1 h-3 w-3 shrink-0 rounded-full border-2", status === s.value ? "border-accent bg-accent" : "border-line-strong")} aria-hidden />
                <span>
                  <span className={cn("block text-[13px] font-medium", status === s.value ? "text-accent-text" : "text-fg")}>{s.label}</span>
                  <span className="block text-[11px] text-fg-subtle">{s.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {status === "OPEN" && (
              <Field label="Booked for" required>
                <Input type="date" required value={dates.scheduledAt} onChange={(e) => setDate("scheduledAt", e.target.value)} className="num" />
              </Field>
            )}
            <input type="hidden" name="scheduledAt" value={submitted("scheduledAt")} />
            {status !== "OPEN" && (
              <Field label="In the shop since" required>
                <Input type="datetime-local" required value={dates.inAt} max={status === "IN_PROGRESS" ? now : undefined} onChange={(e) => setDate("inAt", e.target.value)} className="num" />
              </Field>
            )}
            <input type="hidden" name="inAt" value={status === "OPEN" ? "" : submitted("inAt")} />
            {status !== "DONE" && (
              <TipField id={`${uid}-promised`} label="Promised back" tip="The date the shop said the unit will be ready. Past it, the repair counts as overdue.">
                <Input id={`${uid}-promised`} type="date" value={dates.promisedAt} min={dates.scheduledAt || undefined} onChange={(e) => setDate("promisedAt", e.target.value)} className="num" />
              </TipField>
            )}
            <input type="hidden" name="promisedAt" value={submitted("promisedAt")} />
            {status === "DONE" && (
              <Field label="Back in service" required>
                <Input type="datetime-local" required value={dates.outAt} min={dates.inAt || undefined} max={now} onChange={(e) => setDate("outAt", e.target.value)} className="num" />
              </Field>
            )}
            <input type="hidden" name="outAt" value={status === "DONE" ? submitted("outAt") : ""} />
          </div>
        </Card>

        <Card title="Shop">
          <VendorPicker id={`${uid}-vendor`} vendors={vendors} defaultVendorId={initial.vendorId} legacyName={initial.vendorName} />
        </Card>

        {mode === "truck" && (
          <Card title={`Odometer (${dist})`}>
            <div className="grid grid-cols-2 gap-3">
              <TipField id={`${uid}-odo-in`} label="In" tip="Prefilled from the truck; correct it to the reading at drop-off.">
                <Input id={`${uid}-odo-in`} name="odometerKm" type="number" inputMode="numeric" min={0} value={odometer}
                  onChange={(e) => { setOdometer(e.target.value); setOdometerTouched(true); }} className="num" />
              </TipField>
              <TipField id={`${uid}-odo-out`} label="Out" tip="The reading when it came back. A newer reading moves the truck's odometer forward.">
                <Input id={`${uid}-odo-out`} name="odometerOutKm" type="number" inputMode="numeric" min={odometer || 0} value={odometerOut}
                  onChange={(e) => setOdometerOut(e.target.value)} className="num" disabled={!completed} placeholder={completed ? "" : "At close-out"} />
              </TipField>
            </div>
          </Card>
        )}

        {money ? (
          <Card title="Invoice" actions={<InfoTip>Attach the invoice file on the repair page after saving.</InfoTip>}>
            <div className="grid grid-cols-2 gap-3">
              <TipField id={`${uid}-inv-total`} label="Total" required={completed} tip="Starts as the lines total. Type to use the invoice's own total."
                hint={invoiceTouched && linesTotal && Number(invoice) !== linesTotal ? `Lines total ${f.money2(linesTotal)}` : undefined}>
                <Input id={`${uid}-inv-total`} name="invoiceTotal" type="number" inputMode="decimal" min={0} step="0.01" value={shownInvoice} required={completed}
                  onChange={(e) => { const v = e.target.value; setInvoice(v); setInvoiceTouched(v !== ""); }} className="num font-semibold" placeholder="0.00" />
              </TipField>
              <Field label="Invoice number">
                <Input name="invoiceNumber" defaultValue={initial.invoiceNumber ?? ""} className="num" />
              </Field>
            </div>
            <input type="hidden" name="paymentStatus" value={paymentStatus} />
            <div className="mt-3">
              <span className="mb-1 block text-[12px] font-medium text-fg-muted">Payment{completed && <span className="text-danger"> *</span>}</span>
              <div className={segmentedTrack} role="radiogroup" aria-label="Payment">
                {PAYMENT_STATUSES.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={paymentStatus === p} onClick={() => setPaymentStatus(paymentStatus === p ? "" : p)} className={segmentedThumb(paymentStatus === p)}>
                    {PAYMENT_STATUS_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        ) : (
          <p className="px-1 text-[12px] text-fg-subtle">Costs and invoices are kept by owners, admins and fleet specialists.</p>
        )}

        <div className="flex items-center gap-2">
          <SubmitButton className="flex-1">{submitLabel}</SubmitButton>
          <Link href={cancelHref} className={buttonClass("secondary")}>Cancel</Link>
        </div>
      </div>
    </ActionForm>
  );
}
