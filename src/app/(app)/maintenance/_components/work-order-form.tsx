"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Container, Truck as TruckIcon } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, InfoTip, Input, Select, Textarea, buttonClass, cn } from "@/components/ui";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_CATEGORY_LABELS, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, humanize } from "@/lib/constants";
import { money2, number } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { IN_HOUSE_VENDOR } from "../_lib/shared";

export type UnitOption = {
  id: string; unitNumber: string; detail: string; odometerKm?: number;
  /** Odometer at the truck's last PM, to flag a PM reading below it. */
  lastPmKm?: number | null;
};

type DateKey = "scheduledAt" | "inAt" | "outAt";

/**
 * Serialisable initial values. Dates are input strings rendered on the server, in the zone the action reads them
 * back in: `scheduledAt` as yyyy-MM-dd, `inAt` / `outAt` as yyyy-MM-ddTHH:mm. `stamps` are the stored ISO
 * timestamps: a date the user leaves alone is sent back exactly as stored, so saving an unrelated change (a cost,
 * a note) never rounds the check-in time the Start / Complete buttons recorded.
 */
export type WorkOrderFormValues = {
  truckId?: string | null; trailerId?: string | null;
  title?: string | null; description?: string | null;
  category?: string | null; priority?: string | null; status?: string | null;
  vendor?: string | null;
  scheduledAt?: string | null; inAt?: string | null; outAt?: string | null;
  stamps?: Partial<Record<DateKey, string | null>>;
  odometerKm?: number | null; laborCost?: number | null; partsCost?: number | null; cost?: number | null;
  notes?: string | null;
};

type Mode = "truck" | "trailer";

const CATEGORY_OPTIONS = WORK_ORDER_CATEGORIES.map((c) => ({ value: c, label: WORK_ORDER_CATEGORY_LABELS[c] ?? humanize(c) }));
const statusOptions = (list: readonly string[]) => list.map((s) => ({ value: s, label: humanize(s) }));
/**
 * A job already in the shop can only be completed from this form. Cancelling it (which releases the unit) is the
 * Cancel button's job, and moving it back to open or draft would leave the unit in the shop.
 */
const IN_SHOP_STATUSES = ["IN_PROGRESS", "DONE"] as const;
const STATUS_HINT: Record<string, string> = {
  DRAFT: "Draft: visible in the list, no effect on the unit.",
  OPEN: "Open: scheduled work, the unit stays in service until you start it.",
  IN_PROGRESS: "In progress puts the unit in the shop (truck → maintenance, trailer → shop).",
  DONE: "Done releases the unit. Out of the shop is when the work finished; for a PM the service interval restarts from the odometer below.",
  CANCELLED: "Cancelled: kept for history; the unit is not touched. A job already in the shop is cancelled with its Cancel button, which releases the unit.",
};
const IN_SHOP_HINT = "In the shop now. Complete it here, or use Cancel on the work order to stop without finishing; both release the unit.";

const numOrEmpty = (v: number | null | undefined) => (v == null ? "" : String(v));

/**
 * Like Field, but the explanation waits behind an (i) next to the label; `hint` stays visible for warnings.
 * The (i) sits outside the <label>, so the control's accessible name stays just the label.
 */
function TipField({ id, label, tip, hint, required, children }: {
  id: string; label: string; tip?: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label htmlFor={id} className="text-[12px] font-medium text-fg-muted">{label}{required && <span className="text-danger"> *</span>}</label>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-subtle">{hint}</span>}
    </div>
  );
}

export function WorkOrderForm({ action, trucks, trailers, vendors = [], initial = {}, savedStatus, now, submitLabel, cancelHref }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  trucks: UnitOption[];
  trailers: UnitOption[];
  /** Known vendors, offered as autocomplete suggestions. */
  vendors?: string[];
  initial?: WorkOrderFormValues;
  /** Status stored on the work order being edited; omit when creating one. */
  savedStatus?: string;
  /** Server time as yyyy-MM-ddTHH:mm: fills "Out of the shop" when the job is set to done. */
  now?: string;
  submitLabel: string;
  cancelHref: string;
}) {
  const inShop = savedStatus === "IN_PROGRESS";
  const uid = useId();
  const [mode, setMode] = useState<Mode>(initial.trailerId && !initial.truckId ? "trailer" : "truck");
  const [truckId, setTruckId] = useState(initial.truckId ?? "");
  const [trailerId, setTrailerId] = useState(initial.trailerId ?? "");
  const [category, setCategory] = useState(initial.category ?? "OTHER");
  const [status, setStatus] = useState(initial.status ?? "OPEN");
  const [odometer, setOdometer] = useState(numOrEmpty(initial.odometerKm));
  const [odometerTouched, setOdometerTouched] = useState(initial.odometerKm != null);
  const [labor, setLabor] = useState(numOrEmpty(initial.laborCost));
  const [parts, setParts] = useState(numOrEmpty(initial.partsCost));
  const sumOf = (a: string, b: string) => (Number(a) || 0) + (Number(b) || 0);
  const [manualTotal, setManualTotal] = useState(initial.cost != null && initial.cost !== sumOf(numOrEmpty(initial.laborCost), numOrEmpty(initial.partsCost)));
  const [total, setTotal] = useState(numOrEmpty(initial.cost));
  const [dates, setDates] = useState<Record<DateKey, string>>({ scheduledAt: initial.scheduledAt ?? "", inAt: initial.inAt ?? "", outAt: initial.outAt ?? "" });

  const sum = sumOf(labor, parts);
  const shownTotal = manualTotal ? total : sum ? String(sum) : "";
  const truck = trucks.find((t) => t.id === truckId);
  const unit = mode === "truck" ? truck : trailers.find((t) => t.id === trailerId);
  const lastPmKm = mode === "truck" && category === "PM" ? truck?.lastPmKm : null;
  const belowLastPm = lastPmKm != null && odometer !== "" && Number(odometer) < lastPmKm;

  const setDate = (k: DateKey, v: string) => setDates((d) => ({ ...d, [k]: v }));
  /** The stored timestamp while the field still shows it, else what was typed. */
  const submitted = (k: DateKey) => {
    const stamp = initial.stamps?.[k];
    return stamp && dates[k] === (initial[k] ?? "") ? stamp : dates[k];
  };
  const changeStatus = (next: string) => {
    setStatus(next);
    if (next === "DONE" && !dates.outAt && now) setDate("outAt", now);
  };

  // The odometer follows the picked truck until the user types a reading of their own.
  const pickTruck = (id: string) => {
    setTruckId(id);
    const t = trucks.find((x) => x.id === id);
    if (!odometerTouched) setOdometer(numOrEmpty(t?.odometerKm));
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    if (!odometerTouched) setOdometer(next === "truck" ? numOrEmpty(truck?.odometerKm) : "");
  };

  const toggle = (next: Mode) => (
    <button type="button" onClick={() => switchMode(next)} aria-pressed={mode === next}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors",
        mode === next ? "bg-primary text-on-primary" : "text-fg-muted hover:text-fg")}>
      {next === "truck" ? <TruckIcon className="h-3.5 w-3.5" /> : <Container className="h-3.5 w-3.5" />}
      {next === "truck" ? "Truck" : "Trailer"}
    </button>
  );

  return (
    <ActionForm action={action} className="grid gap-4 xl:grid-cols-3">
      {/* The status this page was drawn for: the server refuses the save if the job moved on in the meantime. */}
      {savedStatus && <input type="hidden" name="savedStatus" value={savedStatus} />}
      <div className="space-y-4 xl:col-span-2">
        <Card title="Unit" actions={!inShop && <div className="inline-flex rounded-md border border-line bg-surface p-0.5">{toggle("truck")}{toggle("trailer")}</div>}>
          {inShop ? (
            // Swapping the unit of a job in progress would leave the first unit in the shop.
            <Field label={mode === "truck" ? "Truck" : "Trailer"} hint="In the shop on this job. Complete or cancel it before moving the work to another unit.">
              <Input readOnly value={unit ? `${unit.unitNumber} · ${unit.detail}` : "—"} className="bg-sunken text-fg-muted" />
              <input type="hidden" name={mode === "truck" ? "truckId" : "trailerId"} value={mode === "truck" ? truckId : trailerId} />
            </Field>
          ) : mode === "truck" ? (
            <Field label="Truck" required hint={truck ? `Odometer ${number(truck.odometerKm)} km · ${truck.detail}` : undefined}>
              <Select name="truckId" required value={truckId} onChange={(e) => pickTruck(e.target.value)} placeholder="Select a truck…"
                options={trucks.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.detail}` }))} />
            </Field>
          ) : (
            <Field label="Trailer" required hint={unit ? unit.detail : undefined}>
              <Select name="trailerId" required value={trailerId} onChange={(e) => setTrailerId(e.target.value)} placeholder="Select a trailer…"
                options={trailers.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.detail}` }))} />
            </Field>
          )}
        </Card>

        <Card title="Work">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required className="sm:col-span-2">
              <Input name="title" required defaultValue={initial.title ?? (category === "PM" ? "PM service" : "")} placeholder="e.g. Replace front brake pads" />
            </Field>
            <Field label="Category">
              <Select name="category" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
            </Field>
            <Field label="Priority">
              <Select name="priority" defaultValue={initial.priority ?? "MEDIUM"} options={WORK_ORDER_PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
            </Field>
            <TipField id={`${uid}-status`} label="Status" tip={inShop && status === "IN_PROGRESS" ? IN_SHOP_HINT : STATUS_HINT[status]}>
              <Select id={`${uid}-status`} name="status" value={status} onChange={(e) => changeStatus(e.target.value)} options={statusOptions(inShop ? IN_SHOP_STATUSES : WORK_ORDER_STATUSES)} />
            </TipField>
            <TipField id={`${uid}-vendor`} label="Vendor / shop" tip={<>Your own shop is {IN_HOUSE_VENDOR}; outside shops are suggested as you type.</>}>
              <Input id={`${uid}-vendor`} name="vendor" defaultValue={initial.vendor ?? ""} placeholder="e.g. Volvo Center Tashkent" list={vendors.length ? "wo-vendors" : undefined} />
              {vendors.length > 0 && <datalist id="wo-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>}
            </TipField>
            <Field label="Description" className="sm:col-span-2">
              <Textarea name="description" defaultValue={initial.description ?? ""} placeholder="Symptoms, diagnosis, parts to order…" />
            </Field>
            <Field label="Internal notes" className="sm:col-span-2">
              <Textarea name="notes" rows={2} defaultValue={initial.notes ?? ""} placeholder="Not shown to vendors or drivers" />
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Schedule">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            {/* Visible inputs carry no name: the hidden twins submit the stored timestamp or the edited value. */}
            <Field label="Scheduled for" required>
              <Input type="date" required value={dates.scheduledAt} onChange={(e) => setDate("scheduledAt", e.target.value)} />
              <input type="hidden" name="scheduledAt" value={submitted("scheduledAt")} />
            </Field>
            <Field label="Into the shop">
              <Input type="datetime-local" value={dates.inAt} onChange={(e) => setDate("inAt", e.target.value)} className="num" />
              <input type="hidden" name="inAt" value={submitted("inAt")} />
            </Field>
            <Field label="Out of the shop" required={status === "DONE"}>
              <Input type="datetime-local" required={status === "DONE"} min={dates.inAt || undefined} value={dates.outAt} onChange={(e) => setDate("outAt", e.target.value)} className="num" />
              <input type="hidden" name="outAt" value={submitted("outAt")} />
            </Field>
            <TipField id={`${uid}-odometer`} label="Odometer (km)"
              tip={mode === "truck" ? (category === "PM" ? "Used to reset the PM interval when this work order is done." : "Prefilled from the truck; adjust to the reading at check-in.") : "Optional for trailers."}
              hint={belowLastPm ? <span className="text-warn">Below this truck&apos;s last PM reading of {number(lastPmKm)} km.</span> : undefined}>
              <Input id={`${uid}-odometer`} name="odometerKm" type="number" inputMode="numeric" min={0} value={odometer} onChange={(e) => { setOdometer(e.target.value); setOdometerTouched(true); }} className="num" />
            </TipField>
          </div>
        </Card>

        <Card title="Costs">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Field label="Labour"><Input name="laborCost" type="number" inputMode="decimal" min={0} step="0.01" value={labor} onChange={(e) => setLabor(e.target.value)} className="num" placeholder="0" /></Field>
            <Field label="Parts"><Input name="partsCost" type="number" inputMode="decimal" min={0} step="0.01" value={parts} onChange={(e) => setParts(e.target.value)} className="num" placeholder="0" /></Field>
            <TipField id={`${uid}-total`} label="Total" tip="Summed from labour + parts. Type to override; clear the field to sum again."
              hint={manualTotal ? `Edited by hand · labour + parts = ${money2(sum)}` : undefined}>
              <Input id={`${uid}-total`} name="cost" type="number" inputMode="decimal" min={0} step="0.01" value={shownTotal}
                onChange={(e) => { const v = e.target.value; if (v === "") { setManualTotal(false); setTotal(""); } else { setManualTotal(true); setTotal(v); } }}
                className="num font-semibold" placeholder="0" />
            </TipField>
          </div>
        </Card>

        <div className="flex items-center gap-2">
          <SubmitButton className="flex-1">{submitLabel}</SubmitButton>
          <Link href={cancelHref} className={buttonClass("secondary")}>Cancel</Link>
        </div>
      </div>
    </ActionForm>
  );
}
