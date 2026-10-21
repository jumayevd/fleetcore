"use client";

import Link from "next/link";
import { useId, useState, type ChangeEvent } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Input, Select, Textarea, buttonClass, segmentedThumb, segmentedTrack } from "@/components/ui";
import { useFormat } from "@/components/locale";
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from "@/lib/constants";
import { logOilChange } from "@/app/actions/oil";
import { LinesEditor } from "@/components/shop/lines-editor";
import { VendorPicker } from "@/components/shop/vendor-picker";
import { OIL_CHECKLIST, type VendorOption } from "@/components/shop/shared";

export type OilTruckOption = { id: string; unitNumber: string; detail: string; odometerKm: number; odometerAt: string | null; lastPmKm: number | null };

/**
 * "Log oil change": unit, when, odometer at the service, the checklist (oil & filter restarts the interval), other
 * work, shop and invoice. Saves one completed repair order.
 */
export function OilLogForm({ trucks, vendors, money, now, defaultTruckId, cancelHref }: {
  trucks: OilTruckOption[];
  vendors: VendorOption[];
  money: boolean;
  /** Company time now, yyyy-MM-ddTHH:mm. */
  now: string;
  defaultTruckId?: string | null;
  cancelHref: string;
}) {
  const f = useFormat();
  const uid = useId();
  const [truckId, setTruckId] = useState(defaultTruckId ?? "");
  const truck = trucks.find((t) => t.id === truckId);
  const [odometer, setOdometer] = useState(truck ? String(truck.odometerKm) : "");
  const [touched, setTouched] = useState(false);
  const [oil, setOil] = useState(true);
  const [linesTotal, setLinesTotal] = useState(0);
  const [total, setTotal] = useState("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [paid, setPaid] = useState("");
  const shownTotal = totalTouched ? total : linesTotal ? String(linesTotal) : "";
  const below = truck?.lastPmKm != null && odometer !== "" && Number(odometer) < truck.lastPmKm;

  const pick = (id: string) => {
    setTruckId(id);
    const t = trucks.find((x) => x.id === id);
    if (!touched) setOdometer(t ? String(t.odometerKm) : "");
  };

  return (
    <ActionForm action={logOilChange} className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <Field label="Truck" required hint={truck ? `Last reading ${f.dist(truck.odometerKm)}${truck.odometerAt ? ` on ${f.date(truck.odometerAt)}` : ""}` : undefined}>
          <Select name="truckId" required value={truckId} onChange={(e) => pick(e.target.value)} placeholder="Pick a truck…"
            options={trucks.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.detail}` }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Done on" required>
            <Input type="datetime-local" name="serviceAt" required defaultValue={now} max={now} className="num" />
          </Field>
          <Field label={`Odometer at service (${f.labels.distance})`} required
            hint={below ? <span className="text-warn">Below the last oil change at {f.dist(truck?.lastPmKm)}; the interval will not move back.</span> : undefined}>
            <Input type="number" name="odometerKm" required min={0} inputMode="numeric" value={odometer} onChange={(e) => { setOdometer(e.target.value); setTouched(true); }} className="num" />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-fg-muted">What was done</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {OIL_CHECKLIST.map((c) => (
              <Checkbox key={c.key} name={`check_${c.key}`} label={c.label}
                {...(c.key === "OIL_FILTER" ? { checked: oil, onChange: (e: ChangeEvent<HTMLInputElement>) => setOil(e.target.checked) } : {})} />
            ))}
          </div>
          <p className={oil ? "mt-1.5 text-[11px] text-fg-subtle" : "mt-1.5 text-[11px] text-warn"}>
            {oil ? "Oil & filter restarts the oil interval from this odometer." : "Without oil & filter this is kept as a PM service and the oil interval is not reset."}
          </p>
        </fieldset>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-fg-muted">Other work</p>
          <LinesEditor money={money} defaultSystem="PM" minRows={0} addLabel="Add other work" onTotal={setLinesTotal} placeholder="e.g. Replaced wiper blades" />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor={`${uid}-shop`} className="mb-1 block text-[12px] font-medium text-fg-muted">Shop</label>
          <VendorPicker id={`${uid}-shop`} vendors={vendors} />
        </div>
        {money && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice total" required hint={!totalTouched ? "0 if it was done in-house at no charge" : undefined}>
                <Input type="number" name="invoiceTotal" required min={0} step="0.01" inputMode="decimal" value={shownTotal}
                  onChange={(e) => { setTotal(e.target.value); setTotalTouched(e.target.value !== ""); }} className="num font-semibold" placeholder="0.00" />
              </Field>
              <Field label="Invoice number">
                <Input name="invoiceNumber" className="num" />
              </Field>
            </div>
            <div>
              <span className="mb-1 block text-[12px] font-medium text-fg-muted">Payment</span>
              <input type="hidden" name="paymentStatus" value={paid} />
              <div className={segmentedTrack} role="radiogroup" aria-label="Payment">
                {PAYMENT_STATUSES.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={paid === p} onClick={() => setPaid(paid === p ? "" : p)} className={segmentedThumb(paid === p)}>{PAYMENT_STATUS_LABELS[p]}</button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-fg-subtle">Attach the invoice file on the repair order that opens after saving.</p>
          </>
        )}
        <Field label="Notes">
          <Textarea name="description" rows={2} placeholder="Oil brand and grade, anything the shop flagged" />
        </Field>
        <div className="flex items-center gap-2 pt-1">
          <SubmitButton className="flex-1" pendingText="Logging…">Log oil change</SubmitButton>
          <Link href={cancelHref} className={buttonClass("secondary")}>Cancel</Link>
        </div>
      </div>
    </ActionForm>
  );
}
