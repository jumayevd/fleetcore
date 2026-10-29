"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { TRUCK_STATUSES } from "@/lib/constants";
import { Badge, STATUS_TONE, StatusDot, TONE_DOT, TONE_SOFT, cn, type Tone } from "@/components/ui";
import { setTruckStatus } from "./actions";
import { Popover, menuItemClass, useMenuKeys } from "./menu";
import { truckStatusLabel, truckStatusTone } from "./lib";

/** The status as a tinted pill with a chevron: reads like a select, so it's plain that it changes the status. */
export const statusPillClass = (tone: Tone) =>
  // Width in px like the text (density scales rem, not type), wide enough for "In maintenance" and "Out of service".
  cn("inline-flex h-7 w-[164px] max-w-full items-center justify-between gap-2 rounded-full border border-current/25 px-2.5 text-[12px] font-medium",
    "transition-[filter,box-shadow] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", TONE_SOFT[tone]);

export function StatusPillFace({ tone, label }: { tone: Tone; label: string }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5"><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} /><span className="truncate">{label}</span></span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
    </>
  );
}

const HINT: Record<string, string> = {
  ACTIVE: "in service", MAINTENANCE: "in the shop", VENDOR: "outside shop or dealer", OUT_OF_SERVICE: "can't run", INACTIVE: "sold or parked",
};

/**
 * A truck's status on the trucks list: the pill opens the statuses and one click sets it (setTruckStatus), without
 * opening the truck. In service reads Available or Assigned by whether the truck has a driver.
 */
export function TruckStatusPill({ id, status, hasDriver, editable }: { id: string; status: string; hasDriver: boolean; editable: boolean }) {
  const key = truckStatusTone(status, hasDriver);
  const tone: Tone = STATUS_TONE[key] ?? "neutral";
  const label = truckStatusLabel(status, hasDriver);
  if (!editable) return <Badge value={key} label={label} dot />;
  return (
    <Popover width={248} align="start" trigger={({ open, toggle }) => (
      <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Status: ${label}. Change status`}
        className={cn(statusPillClass(tone), open && "ring-2 ring-accent/30")}>
        <StatusPillFace tone={tone} label={label} />
      </button>
    )}>
      {(close) => <StatusList id={id} status={status} hasDriver={hasDriver} close={close} />}
    </Popover>
  );
}

function StatusList({ id, status, hasDriver, close }: { id: string; status: string; hasDriver: boolean; close: () => void }) {
  const { ref, onKeyDown } = useMenuKeys();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (next: string) => start(async () => {
    setError(null);
    try {
      const res = await setTruckStatus(id, next);
      if (res?.error) setError(res.error);
      else close();
    } catch {
      setError("Could not change the status. Refresh the page and try again.");
    }
  });
  return (
    <div>
      <p className="px-2 pb-1 pt-1 text-[11px] text-fg-subtle">Set status</p>
      <ul ref={ref} role="menu" aria-label="Truck status" onKeyDown={onKeyDown} className="space-y-px">
        {TRUCK_STATUSES.map((s) => (
          <li key={s} role="none">
            <button type="button" role="menuitem" disabled={pending || s === status} onClick={() => pick(s)}
              className={cn(menuItemClass, s === status && "bg-raised font-medium")}>
              <StatusDot tone={STATUS_TONE[truckStatusTone(s, hasDriver)] ?? "neutral"} />
              <span className="flex-1">{truckStatusLabel(s, hasDriver)}</span>
              <span className="text-[10px] text-fg-subtle">{s === status ? "current" : HINT[s]}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">{error}</p>}
      <p className="mt-1 border-t border-line px-2 pt-1.5 text-[10px] leading-4 text-fg-subtle">
        In service reads {hasDriver ? "Assigned while it has a driver" : "Available until it gets a driver"}. Starting a repair moves it to In maintenance.
      </p>
    </div>
  );
}
