"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Button, Card, Checkbox, Field, IconButton, Input, Select, Textarea, buttonClass, cn, inputClass } from "@/components/ui";
import { INSPECTION_LEVELS, INSPECTION_LEVEL_LABELS, ROADSIDE_STATUSES } from "@/lib/constants";
import type { ActionState } from "@/lib/action";
import {
  CORRECTION_DAYS, ROADSIDE_RESULT_TONE, VIOLATION_UNITS, VIOLATION_UNIT_LABELS, roadsideResult, roadsideResultLabel, roadsideStatusLabel,
} from "@/lib/pti-shared";

export type ViolationLine = { id?: string; code: string; description: string; unit: string; oos: boolean; corrected: boolean };
export type RoadsideFormValues = {
  inspectedAt: string; reportNumber: string; level: number; state: string; location: string;
  driverId: string; truckId: string; trailerId: string;
  correctionDueAt: string; status: string; notes: string;
  violations: ViolationLine[];
};

const STATUS_HINT: Record<string, string> = {
  OPEN: "Something still has to be corrected or certified.",
  CORRECTED: "Everything is corrected; the signed report may still need to go back.",
  CLOSED: "Filed. Nothing left to do.",
};

type Keyed = ViolationLine & { key: string };
const plain = (l: Keyed): ViolationLine => ({ id: l.id, code: l.code, description: l.description, unit: l.unit, oos: l.oos, corrected: l.corrected });

/** Add `days` to a "YYYY-MM-DD…" value (calendar days, no time zone involved). */
function plusDays(value: string, days: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days)).toISOString().slice(0, 10);
}

export function RoadsideForm({ action, initial, drivers, trucks, trailers, submitLabel, cancelHref, editing }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial: RoadsideFormValues;
  drivers: { id: string; label: string; truckId: string | null }[];
  trucks: { id: string; label: string; trailerId: string | null }[];
  trailers: { id: string; label: string }[];
  submitLabel: string;
  cancelHref: string;
  editing: boolean;
}) {
  const [lines, setLines] = useState<Keyed[]>(() => initial.violations.map((l, i) => ({ ...l, key: l.id ?? `init-${i}` })));
  const [added, setAdded] = useState(0);
  const [inspectedAt, setInspectedAt] = useState(initial.inspectedAt);
  const [driverId, setDriverId] = useState(initial.driverId);
  const [truckId, setTruckId] = useState(initial.truckId);
  const [trailerId, setTrailerId] = useState(initial.trailerId);
  const [due, setDue] = useState(initial.correctionDueAt);
  const [status, setStatus] = useState(initial.status);
  // Picked by hand: the driver → truck → trailer prefill leaves these alone.
  const [touched, setTouched] = useState({ truck: editing && Boolean(initial.truckId), trailer: editing && Boolean(initial.trailerId), status: editing });

  const result = roadsideResult(lines);
  const effectiveStatus = touched.status ? status : lines.length ? "OPEN" : "CLOSED";
  const set = (key: string, patch: Partial<ViolationLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((ls) => [...ls, { key: `new-${added}`, code: "", description: "", unit: truckId ? "TRUCK" : "DRIVER", oos: false, corrected: false }]);
    setAdded((n) => n + 1);
  };

  const followTruck = (id: string) => {
    setTruckId(id);
    if (!touched.trailer) setTrailerId(trucks.find((t) => t.id === id)?.trailerId ?? "");
  };
  const pickDriver = (id: string) => {
    setDriverId(id);
    const t = drivers.find((d) => d.id === id)?.truckId;
    if (t && !touched.truck) followTruck(t);
  };
  const pickTruck = (id: string) => {
    setTouched((s) => ({ ...s, truck: true }));
    followTruck(id);
  };

  return (
    <ActionForm action={action} className="grid gap-4 xl:grid-cols-3">
      <input type="hidden" name="violations" value={JSON.stringify(lines.map(plain))} />
      <div className="space-y-4 xl:col-span-2">
        <Card title="Inspection">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inspected at" required>
              <Input type="datetime-local" name="inspectedAt" required value={inspectedAt} onChange={(e) => setInspectedAt(e.target.value)} className="num" />
            </Field>
            <Field label="Report number" hint="As printed on the inspection report">
              <Input name="reportNumber" defaultValue={initial.reportNumber} placeholder="e.g. TX1234005678" className="num" />
            </Field>
            <Field label="Level">
              <Select name="level" defaultValue={String(initial.level)} options={INSPECTION_LEVELS.map((l) => ({ value: String(l), label: INSPECTION_LEVEL_LABELS[l] }))} />
            </Field>
            <div className="grid grid-cols-[5rem_1fr] gap-3">
              <Field label="State">
                <Input name="state" defaultValue={initial.state} maxLength={3} placeholder="TX" className="uppercase" />
              </Field>
              <Field label="Location">
                <Input name="location" defaultValue={initial.location} placeholder="e.g. I-35 NB weigh station, Laredo" />
              </Field>
            </div>
          </div>
        </Card>

        <Card title={
          <span className="flex items-center gap-2">
            Violations
            <Badge value={result} label={roadsideResultLabel(result)} tone={ROADSIDE_RESULT_TONE[result]} dot />
          </span>
        } actions={<Button size="sm" variant="secondary" onClick={addLine}><Plus />Add violation</Button>}>
          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-[12px] text-fg-muted">
              No violations: the inspection is recorded as clean. Use Add violation for each one on the report.
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((l, i) => (
                <li key={l.key} className={cn("rounded-md border px-3 py-2.5", l.oos ? "border-danger/40 bg-danger-soft/40" : "border-line")}>
                  <div className="grid gap-2 sm:grid-cols-[7rem_1fr_7.5rem_auto]">
                    <Input aria-label={`Violation ${i + 1} code`} value={l.code} onChange={(e) => set(l.key, { code: e.target.value })} placeholder="393.9(a)" className="num" />
                    <Input aria-label={`Violation ${i + 1} description`} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })}
                      placeholder="e.g. Inoperable required lamp, left rear" required />
                    <select aria-label={`Violation ${i + 1} unit`} value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })}
                      className={cn(inputClass, "px-2")}>
                      {VIOLATION_UNITS.map((u) => <option key={u} value={u}>{VIOLATION_UNIT_LABELS[u]}</option>)}
                    </select>
                    <IconButton label={`Remove violation ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="h-8 w-8"><Trash2 /></IconButton>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <Checkbox label={<span className={l.oos ? "font-medium text-danger" : undefined}>Out of service</span>} checked={l.oos} onChange={(e) => set(l.key, { oos: e.target.checked })} />
                    <Checkbox label="Corrected" checked={l.corrected} onChange={(e) => set(l.key, { corrected: e.target.checked })} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Notes">
          <Textarea name="notes" rows={3} defaultValue={initial.notes} placeholder="What the officer said, what the driver did next, who is handling the correction" />
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Driver and units">
          <div className="space-y-4">
            <Field label="Driver">
              <Select name="driverId" value={driverId} onChange={(e) => pickDriver(e.target.value)} placeholder="No driver on the report" options={drivers.map((d) => ({ value: d.id, label: d.label }))} />
            </Field>
            <Field label="Truck">
              <Select name="truckId" value={truckId} onChange={(e) => pickTruck(e.target.value)} placeholder="No truck" options={trucks.map((t) => ({ value: t.id, label: t.label }))} />
            </Field>
            <Field label="Trailer">
              <Select name="trailerId" value={trailerId} onChange={(e) => { setTouched((s) => ({ ...s, trailer: true })); setTrailerId(e.target.value); }} placeholder="No trailer" options={trailers.map((t) => ({ value: t.id, label: t.label }))} />
            </Field>
          </div>
        </Card>

        <Card title="Follow-up">
          <div className="space-y-4">
            <Field label="Correction due" hint={
              <span>Corrections are usually certified within {CORRECTION_DAYS} days.{" "}
                {inspectedAt && (
                  <button type="button" onClick={() => setDue(plusDays(inspectedAt, CORRECTION_DAYS))} className="font-medium text-accent-text hover:underline">
                    Set to {CORRECTION_DAYS} days after
                  </button>
                )}
              </span>
            }>
              <Input type="date" name="correctionDueAt" value={due} onChange={(e) => setDue(e.target.value)} className="num" />
            </Field>
            <Field label="Status" hint={STATUS_HINT[effectiveStatus]}>
              <Select name="status" value={effectiveStatus} onChange={(e) => { setTouched((s) => ({ ...s, status: true })); setStatus(e.target.value); }}
                options={ROADSIDE_STATUSES.map((s) => ({ value: s, label: roadsideStatusLabel(s) }))} />
            </Field>
          </div>
        </Card>

        {!editing && <p className="px-1 text-[12px] text-fg-subtle">Attach the inspection report and proof of correction after saving.</p>}
        <div className="flex items-center gap-2">
          <SubmitButton className="flex-1">{submitLabel}</SubmitButton>
          <Link href={cancelHref} className={buttonClass("secondary")}>Cancel</Link>
        </div>
      </div>
    </ActionForm>
  );
}
