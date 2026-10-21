"use client";

import { useRef, useState, useTransition } from "react";
import { Settings2, Trash2, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, IconButton, Input, cn, inputClass } from "@/components/ui";
import { useFormat } from "@/components/locale";
import { deleteTruckType, saveTruckType, setTruckType } from "@/app/actions/oil";

export type TruckTypeOption = { id: string; name: string; oilIntervalKm: number; trucks: number };

/** One type on the dialog: name and interval, saved in place. */
function TypeRow({ t }: { t: TruckTypeOption }) {
  const f = useFormat();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remove = () => {
    const msg = t.trucks ? `Delete ${t.name}? Its ${t.trucks} ${t.trucks === 1 ? "truck goes" : "trucks go"} back to their own interval.` : `Delete ${t.name}?`;
    if (!window.confirm(msg)) return;
    start(async () => {
      const res = await deleteTruckType(t.id).catch(() => ({ error: "Could not delete it. Try again." }));
      if (res?.error) setError(res.error);
    });
  };
  return (
    <li className="py-2">
      <ActionForm action={saveTruckType.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
        <Input name="name" defaultValue={t.name} required aria-label="Type name" className="min-w-0 flex-1" maxLength={60} />
        <div className="relative w-36">
          <Input name="oilIntervalKm" type="number" min={1000} step={500} required defaultValue={t.oilIntervalKm} aria-label={`Oil interval (${f.labels.distance})`} className="num pr-9 text-right" />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-fg-subtle">{f.labels.distance}</span>
        </div>
        <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
        <IconButton label={`Delete ${t.name}`} onClick={remove} disabled={pending}><Trash2 /></IconButton>
      </ActionForm>
      <p className="mt-0.5 text-[11px] text-fg-subtle">{t.trucks ? `${t.trucks} ${t.trucks === 1 ? "truck" : "trucks"}` : "No trucks yet"}</p>
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
    </li>
  );
}

/** "Truck types" button and dialog: each type's oil change interval, in the company's distance unit. */
export function TruckTypesDialog({ types, editable }: { types: TruckTypeOption[]; editable: boolean }) {
  const f = useFormat();
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => ref.current?.showModal()}><Settings2 />Truck types</Button>
      <dialog ref={ref} aria-labelledby="truck-types-title"
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-line bg-overlay p-0 text-fg shadow-float backdrop:bg-fg/30">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 id="truck-types-title" className="text-[14px] font-semibold">Truck types</h2>
            <p className="text-[12px] text-fg-subtle">Each type has its own oil change interval. A truck without a type uses its own.</p>
          </div>
          <IconButton label="Close" onClick={() => ref.current?.close()}><X /></IconButton>
        </div>
        <div className="max-h-[60vh] overflow-auto px-4">
          {types.length === 0 && <p className="py-4 text-[12px] text-fg-muted">No types yet. Add one below, then pick it per truck on the board or on the truck form.</p>}
          {editable ? (
            <ul className="divide-y divide-line">{types.map((t) => <TypeRow key={`${t.id}:${t.name}:${t.oilIntervalKm}`} t={t} />)}</ul>
          ) : (
            <ul className="divide-y divide-line">
              {types.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-[13px]"><span>{t.name}</span><span className="num text-fg-muted">{f.dist(t.oilIntervalKm)}</span></li>
              ))}
            </ul>
          )}
        </div>
        {editable && (
          <div className="border-t border-line bg-sunken/40 px-4 py-3">
            <p className="mb-2 text-[12px] font-medium text-fg-muted">Add a type</p>
            <ActionForm action={saveTruckType.bind(null, null)} resetOnSuccess className="flex flex-wrap items-center gap-2">
              <Input name="name" required placeholder="e.g. Cascadia DD15" aria-label="Type name" className="min-w-0 flex-1" maxLength={60} />
              <div className="relative w-36">
                <Input name="oilIntervalKm" type="number" min={1000} step={500} required placeholder={f.imperial ? "25000" : "40000"} aria-label={`Oil interval (${f.labels.distance})`} className="num pr-9 text-right" />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-fg-subtle">{f.labels.distance}</span>
              </div>
              <SubmitButton size="sm" pendingText="Adding…">Add type</SubmitButton>
            </ActionForm>
          </div>
        )}
      </dialog>
    </>
  );
}

/** Quick "set type" per truck on the oil board. */
export function TruckTypeSelect({ truckId, value, types }: { truckId: string; value: string | null; types: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <select value={value ?? ""} disabled={pending} aria-label="Truck type"
        onChange={(e) => {
          const next = e.target.value || null;
          start(async () => {
            setError(null);
            const res = await setTruckType(truckId, next).catch(() => ({ error: "Could not save. Try again." }));
            if (res?.error) setError(res.error);
          });
        }}
        className={cn(inputClass, "h-7 w-36 text-[12px]", !value && "text-fg-subtle")}>
        <option value="">Own interval</option>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
