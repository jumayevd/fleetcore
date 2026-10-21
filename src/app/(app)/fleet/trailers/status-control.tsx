"use client";

import { useId, useState, useTransition } from "react";
import { ChevronDown, ArrowLeft } from "lucide-react";
import { TRAILER_STATUSES, TRAILER_STATUS_LABELS } from "@/lib/constants";
import { Badge, STATUS_TONE, StatusDot, buttonClass, cn, inputClass } from "@/components/ui";
import { setTrailerStatus } from "../actions";
import { Popover, menuItemClass, useMenuKeys } from "../menu";

/** Statuses that describe where the trailer is, so we ask for the place. */
const ASKS_LOCATION = new Set(["DROPPED", "YARD"]);

/**
 * Inline status change: the badge is the trigger, a quiet popover lists the other statuses.
 * Dropped / Yard ask where the unit is (one input, Enter to confirm). Errors stay inside the popover.
 */
export function TrailerStatusControl({ id, status, locationName, editable, since }: {
  id: string; status: string; locationName: string | null; editable: boolean; since?: string;
}) {
  if (!editable) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge value={status} label={TRAILER_STATUS_LABELS[status] ?? status} dot />
        {since && <span className="num text-[11px] text-fg-subtle" title="Time in this status">{since}</span>}
      </span>
    );
  }
  return (
    <Popover width={232} align="start" trigger={({ open, toggle }) => (
      <span className="inline-flex items-center gap-1.5">
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title="Change status"
          className={cn("inline-flex items-center gap-1 rounded-md py-0.5 pl-0.5 pr-1 transition-colors hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", open && "bg-raised")}>
          <Badge value={status} label={TRAILER_STATUS_LABELS[status] ?? status} dot />
          <ChevronDown className="h-3 w-3 text-fg-subtle" />
        </button>
        {since && <span className="num text-[11px] text-fg-subtle" title="Time in this status">{since}</span>}
      </span>
    )}>
      {(close) => <StatusPanel id={id} status={status} locationName={locationName} close={close} />}
    </Popover>
  );
}

function StatusPanel({ id, status, locationName, close }: { id: string; status: string; locationName: string | null; close: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  const run = (next: string, where?: string) => start(async () => {
    setError(null);
    try {
      const res = await setTrailerStatus(id, next, where?.trim() || undefined);
      if (res?.error) setError(res.error);
      else close();
    } catch {
      setError("Could not change the status. Refresh the page and try again.");
    }
  });

  if (picking) {
    return (
      <LocationStep status={picking} initial={locationName ?? ""} pending={pending} error={error}
        onBack={() => { setError(null); setPicking(null); }} onConfirm={(where) => run(picking, where)} />
    );
  }
  return <StatusList status={status} pending={pending} error={error} onPick={(s) => (ASKS_LOCATION.has(s) ? setPicking(s) : run(s))} />;
}

function StatusList({ status, pending, error, onPick }: { status: string; pending: boolean; error: string | null; onPick: (status: string) => void }) {
  const { ref, onKeyDown } = useMenuKeys();
  return (
    <div>
      <p className="px-2 pb-1 pt-1 text-[11px] text-fg-subtle">Set status</p>
      <ul ref={ref} role="menu" aria-label="Trailer status" onKeyDown={onKeyDown} className="space-y-px">
        {TRAILER_STATUSES.map((s) => (
          <li key={s} role="none">
            <button type="button" role="menuitem" disabled={pending || s === status} onClick={() => onPick(s)}
              className={cn(menuItemClass, s === status && "bg-raised font-medium")}>
              <StatusDot tone={STATUS_TONE[s] ?? "neutral"} />
              <span className="flex-1">{TRAILER_STATUS_LABELS[s]}</span>
              {s === status && <span className="text-[10px] text-fg-subtle">current</span>}
              {ASKS_LOCATION.has(s) && s !== status && <span className="text-[10px] text-fg-subtle">asks where</span>}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">{error}</p>}
      <p className="mt-1 border-t border-line px-2 pt-1.5 text-[10px] leading-4 text-fg-subtle">Dropped, Yard, Shop and Out of service unpair the truck. Units on an active load stay In use.</p>
    </div>
  );
}

function LocationStep({ status, initial, pending, error, onBack, onConfirm }: {
  status: string; initial: string; pending: boolean; error: string | null; onBack: () => void; onConfirm: (where: string) => void;
}) {
  const inputId = useId();
  const [place, setPlace] = useState(initial);
  return (
    <form className="p-1" onSubmit={(e) => { e.preventDefault(); onConfirm(place); }}>
      <button type="button" onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"><ArrowLeft className="h-3 w-3" />Back</button>
      <label htmlFor={inputId} className="mb-1.5 block text-[12px] font-medium text-fg">{TRAILER_STATUS_LABELS[status]} — where?</label>
      <input id={inputId} autoFocus value={place} onChange={(e) => setPlace(e.target.value)} placeholder={status === "YARD" ? "Tashkent yard" : "Customer yard, city"} className={cn(inputClass, "h-7 text-[12px]")} />
      <div className="mt-2 flex items-center justify-between gap-2">
        {error ? <span role="alert" className="line-clamp-2 text-[11px] text-danger" title={error}>{error}</span> : <span className="text-[11px] text-fg-subtle">Leave empty to keep the current place</span>}
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>{pending ? "Saving…" : "Confirm"}</button>
      </div>
    </form>
  );
}
