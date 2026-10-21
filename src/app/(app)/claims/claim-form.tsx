"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, Input, LinkButton, Select, Textarea, cn } from "@/components/ui";
import { CLAIM_FAULTS, CLAIM_FAULT_LABELS, CLAIM_SEVERITIES, CLAIM_TYPES, CLAIM_TYPE_LABELS } from "@/lib/constants";
import { money, toLocalInput } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { Combobox } from "./combobox";
import {
  CLAIM_SEVERITY_LABELS, CLAIM_TYPE_DOC_HINT, claimStatusLabel, recoveryPct,
  type ClaimDefaults, type ClaimFormOptions, type ClaimStatus, type LoadOption,
} from "./shared";

const s = (v: string | number | null | undefined) => (v == null ? "" : String(v));

/**
 * Create / edit a claim. Picking a load fills in the driver, unit, customer, incident place and
 * time (when the load is delivered); every prefilled value stays editable.
 */
export function ClaimForm({ action, options, defaults = {}, mode = "create", statusOptions, prefilledFrom, submitLabel, cancelHref = "/claims", maxIncident }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  options: ClaimFormOptions;
  defaults?: ClaimDefaults;
  /**
   * Latest allowed incident time, pre-formatted on the server (end of today in the company time zone,
   * the zone the server reads the field in). Computing it here would differ between the server render
   * and hydration.
   */
  maxIncident?: string;
  mode?: "create" | "edit";
  /** Edit only: the current status followed by the lifecycle steps allowed from it. */
  statusOptions?: ClaimStatus[];
  /** Load reference the defaults came from (`/claims/new?load=…`). */
  prefilledFrom?: string | null;
  submitLabel?: string;
  cancelHref?: string;
}) {
  const [type, setType] = useState(defaults.type ?? "");
  const [incidentAt, setIncidentAt] = useState(s(defaults.incidentAt));
  const [location, setLocation] = useState(s(defaults.location));
  const [loadId, setLoadId] = useState(s(defaults.loadId));
  const [driverId, setDriverId] = useState(s(defaults.driverId));
  const [truckId, setTruckId] = useState(s(defaults.truckId));
  const [trailerId, setTrailerId] = useState(s(defaults.trailerId));
  const [customerId, setCustomerId] = useState(s(defaults.customerId));
  const [claimed, setClaimed] = useState(s(defaults.amountClaimed ?? ""));
  const [settled, setSettled] = useState(s(defaults.amountSettled ?? ""));
  const [filledFrom, setFilledFrom] = useState<{ ref: string; fields: string[] } | null>(
    prefilledFrom ? { ref: prefilledFrom, fields: [] } : null,
  );

  const onLoad = (id: string, opt: LoadOption | null) => {
    setLoadId(id);
    if (!opt) return;
    const filled: string[] = [];
    if (!driverId && opt.driverId) { setDriverId(opt.driverId); filled.push("driver"); }
    if (!truckId && opt.truckId) { setTruckId(opt.truckId); filled.push("truck"); }
    if (!trailerId && opt.trailerId) { setTrailerId(opt.trailerId); filled.push("trailer"); }
    if (!customerId && opt.customerId) { setCustomerId(opt.customerId); filled.push("customer"); }
    if (!location && opt.place) { setLocation(opt.place); filled.push("location"); }
    if (!incidentAt && opt.deliveredAt) { setIncidentAt(toLocalInput(opt.deliveredAt)); filled.push("incident time"); }
    setFilledFrom({ ref: opt.label, fields: filled });
  };

  const claimedN = Math.max(0, Number(claimed) || 0);
  const settledN = settled === "" ? null : Math.max(0, Number(settled) || 0);
  const recovery = recoveryPct(claimedN, settledN);
  const docHint = type ? CLAIM_TYPE_DOC_HINT[type] : null;
  const currentStatus = defaults.status;

  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Incident">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Claim type" required className="lg:col-span-2" hint={docHint ?? "Pick the closest type; it drives the evidence checklist and the analytics."}>
                <Select name="type" required value={type} onChange={(e) => setType(e.target.value)} placeholder="Choose a type…"
                  options={CLAIM_TYPES.map((t) => ({ value: t, label: CLAIM_TYPE_LABELS[t] }))} />
              </Field>
              <Field label="Severity" hint="Critical and high claims alert the group room.">
                <Select name="severity" defaultValue={defaults.severity ?? "MEDIUM"} options={CLAIM_SEVERITIES.map((v) => ({ value: v, label: CLAIM_SEVERITY_LABELS[v] ?? v }))} />
              </Field>
              <Field label="Fault" hint="Change it as the facts come in.">
                <Select name="fault" defaultValue={defaults.fault ?? "UNKNOWN"} options={CLAIM_FAULTS.map((v) => ({ value: v, label: CLAIM_FAULT_LABELS[v] }))} />
              </Field>
              <Field label="Incident date and time" required className="lg:col-span-2">
                <Input type="datetime-local" name="incidentAt" required value={incidentAt} max={maxIncident} onChange={(e) => setIncidentAt(e.target.value)} className="num" />
              </Field>
              <Field label="Location" className="lg:col-span-2" hint="Where it happened — a consignee, a road, a yard.">
                <Input name="location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} placeholder="Consignee warehouse, Samarkand" />
              </Field>
              <Field label="Description" required className="sm:col-span-2 lg:col-span-4" hint="What happened, what was damaged or lost, who was present. This text goes into the claim pack.">
                <Textarea name="description" required rows={5} maxLength={4000} defaultValue={s(defaults.description)}
                  placeholder="Four pallets crushed on arrival; load shift suspected. Photos taken at unloading with the consignee present…" />
              </Field>
            </div>
          </Card>

          <Card
            title="Linked records"
            actions={filledFrom && (
              <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle">
                <Link2 className="h-3 w-3" />Prefilled from <span className="num text-fg-muted">{filledFrom.ref}</span>
                {filledFrom.fields.length > 0 && <span className="hidden sm:inline">· {filledFrom.fields.join(", ")}</span>}
              </span>
            )}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Load" className="sm:col-span-2"
                hint={mode === "edit"
                  ? "Picking a different load fills in only the empty fields below. Clear a field to unlink it — it stays empty when you save."
                  : "Picking a load fills in the driver, unit and customer below. Change or clear anything that differs."}>
                <Combobox name="loadId" mono options={options.loads} value={loadId} placeholder="Search by reference, city, customer, driver or unit…"
                  onChange={(id, opt) => onLoad(id, opt as LoadOption | null)} emptyText="No load matches — leave it empty if the incident is not tied to a load" />
              </Field>
              <Field label="Driver">
                <Combobox name="driverId" options={options.drivers} value={driverId} placeholder="Search drivers…" onChange={(id) => setDriverId(id)} />
              </Field>
              <Field label="Truck">
                <Combobox name="truckId" mono options={options.trucks} value={truckId} placeholder="Search units…" onChange={(id) => setTruckId(id)} />
              </Field>
              <Field label="Trailer">
                <Combobox name="trailerId" mono options={options.trailers} value={trailerId} placeholder="Search trailers…" onChange={(id) => setTrailerId(id)} />
              </Field>
              <Field label="Customer or broker" hint="The counterparty the claim is with (or who filed it against us).">
                <Combobox name="customerId" options={options.customers} value={customerId} placeholder="Search customers and brokers…" onChange={(id) => setCustomerId(id)} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Amounts">
            <div className="space-y-3">
              <Field label="Amount claimed (USD)" hint="What is being asked for. Zero is fine while the figure is unknown.">
                <Input type="number" name="amountClaimed" min={0} step={1} value={claimed} onChange={(e) => setClaimed(e.target.value)} placeholder="0" className="num" />
              </Field>
              <Field label="Amount settled (USD)" hint={mode === "create" ? "Leave empty — it is filled in when the claim is approved or paid." : "Agreed or received so far."}>
                <Input type="number" name="amountSettled" min={0} step={1} value={settled} onChange={(e) => setSettled(e.target.value)} placeholder="—" className="num" />
              </Field>
              <dl className="grid grid-cols-3 gap-2 rounded-md bg-sunken/60 px-3 py-2">
                <div><dt className="text-[11px] text-fg-subtle">Claimed</dt><dd className="num text-[13px] font-medium text-fg">{money(claimedN)}</dd></div>
                <div><dt className="text-[11px] text-fg-subtle">Settled</dt><dd className="num text-[13px] font-medium text-fg">{settledN == null ? "—" : money(settledN)}</dd></div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">Recovery</dt>
                  <dd className={cn("num text-[13px] font-medium", recovery == null ? "text-fg-faint" : recovery >= 80 ? "text-ok" : recovery >= 50 ? "text-fg" : "text-warn")}>
                    {recovery == null ? "—" : `${recovery}%`}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card title="Ownership">
            <div className="space-y-3">
              <Field label="Assigned to" hint="Who runs the claim. They get the Telegram updates.">
                <Select name="assignedToId" defaultValue={s(defaults.assignedToId)} placeholder="Unassigned"
                  options={options.assignees.map((a) => ({ value: a.id, label: a.hint ? `${a.label} · ${a.hint}` : a.label }))} />
              </Field>
              {mode === "edit" && statusOptions && currentStatus ? (
                <Field label="Status" hint="Only the next steps in the lifecycle are offered here; the claim page has the full controls.">
                  <Select name="status" defaultValue={currentStatus}
                    options={statusOptions.map((st) => ({ value: st, label: st === currentStatus ? `${claimStatusLabel(st)} (current)` : claimStatusLabel(st) }))} />
                </Field>
              ) : (
                <div>
                  <span className="mb-1 block text-[12px] font-medium text-fg-muted">Status</span>
                  <div className="flex items-center gap-2">
                    <Badge value="REPORTED" label="Reported" dot />
                    <span className="text-[11px] text-fg-subtle">New claims start here; move them along from the claim page.</span>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[12px] text-fg-muted">
          {type ? CLAIM_TYPE_LABELS[type] : "No type yet"} · claimed <span className="num text-fg">{money(claimedN)}</span>
          {loadId && <> · on <span className="num text-fg">{options.loads.find((l) => l.id === loadId)?.label ?? "a load"}</span></>}
        </p>
        <div className="flex items-center gap-2">
          <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
          <SubmitButton pendingText={mode === "create" ? "Filing claim…" : "Saving…"}>{submitLabel ?? (mode === "create" ? "File claim" : "Save changes")}</SubmitButton>
        </div>
      </footer>
    </ActionForm>
  );
}
