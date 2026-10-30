"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { CheckCheck, Link2, Plus, RotateCcw, Trash2, Unlink, Wrench } from "lucide-react";
import { Badge, Button, Input, Select, Textarea, buttonClass, cn, inputClass } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import type { ActionState } from "@/lib/action";
import { defectLabel, roLabel } from "@/lib/service";
import { assignDefectOwner, closeDefect, deleteDefect, linkDefectRepair, markDefectRepaired, reopenDefect } from "@/app/actions/inspections";
import { Overlay } from "./overlay";

/** Run a defect action, keep its message next to the control. */
function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run = (fn: () => Promise<ActionState>, after?: () => void) => start(async () => {
    setMsg(null);
    try {
      const res = await fn();
      if (res?.error) setMsg({ tone: "error", text: res.error });
      else { after?.(); if (res?.ok) setMsg({ tone: "ok", text: res.ok }); }
    } catch {
      setMsg({ tone: "error", text: "Could not save. Refresh the page and try again." });
    }
  });
  return { pending, msg, run, setMsg };
}

/**
 * Status moves for one defect: Mark repaired (open), Confirm & close (open or repaired, with a note), Reopen
 * (repaired or closed). Closing the last defect that holds a unit puts the unit back in service. Marking repaired and
 * confirming need an owner first; the note is required unless `noteOptional` (admins).
 */
export function DefectActions({ id, number, status, severity, holdsUnit, hasOwner, noteOptional, canDelete, compact }: {
  id: string; number: number; status: string; severity: string; holdsUnit: boolean; hasOwner: boolean; noteOptional: boolean;
  /** Owners and admins: Delete, for a defect reported by mistake or twice. */
  canDelete?: boolean; compact?: boolean;
}) {
  const { pending, msg, run, setMsg } = useRun();
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [why, setWhy] = useState("");
  const [note, setNote] = useState("");
  const label = defectLabel(number);
  const ownerFirst = (step: string) => setMsg({ tone: "error", text: `Give ${label} an owner before ${step}.` });
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {status === "OPEN" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => (hasOwner ? run(() => markDefectRepaired(id)) : ownerFirst("marking it repaired"))}
          title={hasOwner ? "The shop says it is fixed; someone still confirms it" : "Pick an owner first"}>
          <Wrench />{compact ? "Repaired" : "Mark repaired"}
        </Button>
      )}
      {status !== "CLOSED" && (
        <Button size="sm" variant={status === "REPAIRED" ? "secondary" : "ghost"} disabled={pending} onClick={() => (hasOwner ? (setMsg(null), setClosing(true)) : ownerFirst("confirming the repair"))}
          title={!hasOwner ? "Pick an owner first" : holdsUnit ? "Confirm the repair, close it and release the unit" : "Confirm the repair and close it"}>
          <CheckCheck />Confirm &amp; close
        </Button>
      )}
      {status !== "OPEN" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
          if (status === "CLOSED" && !window.confirm(`Reopen ${label}?${severity === "NOW" ? " It takes its unit out of service again." : ""}`)) return;
          run(() => reopenDefect(id));
        }} title="Not fixed after all">
          <RotateCcw />Reopen
        </Button>
      )}
      {canDelete && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setMsg(null); setDeleting(true); }} aria-label={`Delete ${label}`} title="Delete it for good: reported by mistake or twice"
          className="text-fg-subtle hover:text-danger">
          <Trash2 />{compact ? null : "Delete"}
        </Button>
      )}
      {msg && <span role={msg.tone === "error" ? "alert" : "status"} className={cn("basis-full text-right text-[11px]", msg.tone === "error" ? "text-danger" : "text-ok")}>{msg.text}</span>}
      <Overlay variant="dialog" open={deleting} onClose={() => setDeleting(false)} title={`Delete ${label}?`} subtitle="It is removed for good"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => deleteDefect(id, why || null), () => { setDeleting(false); setWhy(""); })}>
              <Trash2 />{pending ? "Deleting…" : `Delete ${label}`}
            </Button>
          </div>
        }>
        <p className="text-[13px] text-fg-muted">
          Use this for a defect reported by mistake or twice. The activity log keeps what it was and who deleted it.
          {holdsUnit && status !== "CLOSED" ? " It is holding its unit: the unit goes back into service if nothing else holds it." : ""}
          {" "}A walk-around mark that raised it stays on that week&apos;s record.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-medium text-fg-muted">Why (optional)</span>
          <Input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="e.g. Reported twice, same as DEF-0004" />
        </label>
        {msg?.tone === "error" && <FormMessage tone="error" className="mt-3">{msg.text}</FormMessage>}
      </Overlay>
      <Overlay variant="dialog" open={closing} onClose={() => setClosing(false)} title={`Confirm and close ${label}`}
        subtitle={holdsUnit ? "It is holding its unit: closing it puts the unit back in service if nothing else holds it." : status === "OPEN" ? "Not marked repaired yet: close it only if you know it is fixed." : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClosing(false)}>Cancel</Button>
            <Button disabled={pending || (!noteOptional && !note.trim())} onClick={() => run(() => closeDefect(id, note || null), () => { setClosing(false); setNote(""); })}>
              <CheckCheck />{pending ? "Saving…" : "Confirm and close"}
            </Button>
          </div>
        }>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-fg-muted">How you checked{!noteOptional && <span className="text-danger"> *</span>}</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} required={!noteOptional} placeholder="e.g. Invoice RO-0142 attached, tire replaced; seen on today's photo" />
          <span className="mt-1 block text-[11px] text-fg-subtle">{noteOptional ? "Optional for admins, kept with the defect." : "Required, kept with the defect."}</span>
        </label>
        {msg?.tone === "error" && <FormMessage tone="error" className="mt-3">{msg.text}</FormMessage>}
      </Overlay>
    </span>
  );
}

/** Owner of a defect, changeable in place. A defect marked repaired keeps an owner until it is closed (`keep`). */
export function OwnerSelect({ id, ownerId, members, disabled, keep }: {
  id: string; ownerId: string | null; members: { id: string; name: string }[]; disabled?: boolean; keep?: boolean;
}) {
  const { pending, msg, run } = useRun();
  const [value, setValue] = useState(ownerId ?? "");
  return (
    <span className="inline-flex flex-col gap-0.5">
      <select aria-label="Owner" value={value} disabled={disabled || pending}
        onChange={(e) => { const v = e.target.value; const was = value; setValue(v); run(() => assignDefectOwner(id, v || null).then((r) => { if (r?.error) setValue(was); return r; })); }}
        className={cn(inputClass, "h-7 w-40 text-[12px]", !value && "text-fg-subtle")}>
        <option value="" disabled={keep && Boolean(value)}>Nobody yet</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {msg?.tone === "error" && <span role="alert" className="text-[11px] text-danger">{msg.text}</span>}
    </span>
  );
}

const WO_TONE: Record<string, "neutral" | "info" | "warn" | "ok" | "danger"> = { DRAFT: "neutral", OPEN: "info", IN_PROGRESS: "warn", DONE: "ok", CANCELLED: "neutral" };
const WO_LABEL: Record<string, string> = { DRAFT: "Draft", OPEN: "Booked", IN_PROGRESS: "In the shop", DONE: "Done", CANCELLED: "Cancelled" };

/**
 * The repair behind a defect: the linked repair order, or "Open repair" (a new order for the unit) and "Link" (one of
 * the unit's open orders).
 */
export function RepairCell({ id, workOrder, openOrders, newHref, editable }: {
  id: string;
  workOrder: { id: string; number: number; status: string } | null;
  openOrders: { id: string; label: string }[];
  newHref: string;
  editable: boolean;
}) {
  const { pending, msg, run } = useRun();
  const [linking, setLinking] = useState(false);
  const pick = useRef<HTMLSelectElement>(null);
  if (workOrder) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Link href={`/maintenance/work-orders/${workOrder.id}`} className="num font-medium text-fg hover:underline">{roLabel(workOrder.number)}</Link>
        <Badge value={workOrder.status} tone={WO_TONE[workOrder.status]} label={WO_LABEL[workOrder.status] ?? workOrder.status} />
        {editable && (
          <button type="button" disabled={pending} onClick={() => run(() => linkDefectRepair(id, null))} aria-label="Unlink repair" title="Unlink this repair order"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-faint hover:bg-raised hover:text-fg [&_svg]:h-3.5 [&_svg]:w-3.5"><Unlink /></button>
        )}
        {msg?.tone === "error" && <span role="alert" className="text-[11px] text-danger">{msg.text}</span>}
      </span>
    );
  }
  if (!editable) return <span className="text-fg-faint">—</span>;
  if (linking && openOrders.length) {
    return (
      <span className="inline-flex items-center gap-1">
        <Select ref={pick} aria-label="Repair order to link" options={openOrders.map((o) => ({ value: o.id, label: o.label }))} className="h-7 w-48 text-[12px]" />
        <Button size="sm" disabled={pending} onClick={() => { const v = pick.current?.value; if (v) run(() => linkDefectRepair(id, v), () => setLinking(false)); }}>Link</Button>
        <Button size="sm" variant="ghost" onClick={() => setLinking(false)}>Cancel</Button>
        {msg?.tone === "error" && <span role="alert" className="text-[11px] text-danger">{msg.text}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Link href={newHref} className={buttonClass("ghost", "sm")}><Plus />Open repair</Link>
      {openOrders.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => setLinking(true)} title={`Link one of ${openOrders.length} open repair orders of this unit`}><Link2 />Link</Button>
      )}
    </span>
  );
}
