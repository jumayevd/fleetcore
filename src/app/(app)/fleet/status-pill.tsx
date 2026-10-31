"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { PICKABLE_TRUCK_STATUSES } from "@/lib/constants";
import { Badge, STATUS_TONE, StatusDot, TONE_DOT, TONE_SOFT, cn, type Tone } from "@/components/ui";
import { Popover, menuItemClass, useMenuKeys } from "./menu";
import { truckStatusLabel, truckStatusTone } from "./lib";
import { InactiveRecord, useTruckStatusChange, type TruckStatusTarget } from "./truck-status-change";

/** The status as a tinted pill with a chevron: reads like a select, so it's plain that it changes the status. */
export const statusPillClass = (tone: Tone) =>
  // Width in px like the text (density scales rem, not type), wide enough for "Out of service".
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

/** What picking each status does, beside it in the menu. */
export const TRUCK_STATUS_HINT: Record<string, string> = {
  ACTIVE: "in service", MAINTENANCE: "opens a repair order", INACTIVE: "asks why",
};

/** The statuses to offer: Out of service only while the truck is in it (a defect sets it, nobody picks it). */
export const truckStatusChoices = (status: string) => [...PICKABLE_TRUCK_STATUSES, ...(status === "OUT_OF_SERVICE" ? ["OUT_OF_SERVICE"] : [])];

/**
 * A truck's status on the trucks list: the pill opens the statuses and sets one without opening the truck
 * (useTruckStatusChange: Inactive and In shop ask first). In service reads Available or Assigned by its driver.
 */
export function TruckStatusPill({ status, editable, ...t }: TruckStatusTarget & { status: string; editable: boolean }) {
  const key = truckStatusTone(status, t.hasDriver);
  const tone: Tone = STATUS_TONE[key] ?? "neutral";
  const label = truckStatusLabel(status, t.hasDriver);
  const change = useTruckStatusChange(t);
  if (!editable) return <span className="inline-flex items-center gap-1.5"><Badge value={key} label={label} dot />{t.isVendor && <VendorChip />}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Popover width={status === "INACTIVE" && t.inactive ? 340 : 256} align="start" trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Status: ${label}. ${status === "INACTIVE" ? "See why, or change status" : "Change status"}`}
          className={cn(statusPillClass(tone), open && "ring-2 ring-accent/30")}>
          <StatusPillFace tone={tone} label={label} />
        </button>
      )}>
        {(close) => (
          <>
            {/* An inactive truck opens on its record: why, since when, who recorded it and the details. */}
            {status === "INACTIVE" && t.inactive && (
              <InactiveRecord info={t.inactive} className="mb-1" onEdit={() => change.pick("INACTIVE", () => close())} />
            )}
            <StatusList status={status} hasDriver={t.hasDriver} pending={change.pending} pick={(s, done) => change.pick(s, (err) => { done(err); if (!err) close(); })}
              isVendor={t.isVendor} toggleVendor={(done) => change.toggleVendor((err) => { done(err); if (!err) close(); })} />
          </>
        )}
      </Popover>
      {t.isVendor && <VendorChip />}
      {change.dialogs}
    </span>
  );
}

/** Beside the status of another company's or owner's truck. */
export function VendorChip() {
  return <span className="rounded bg-progress-soft px-1.5 py-px text-[10.5px] font-medium text-progress" title="Belongs to another company or owner">Vendor</span>;
}

function StatusList({ status, hasDriver, pending, pick, isVendor, toggleVendor }: {
  status: string; hasDriver: boolean; pending: boolean; pick: (status: string, done: (error: string | null) => void) => void;
  isVendor: boolean; toggleVendor: (done: (error: string | null) => void) => void;
}) {
  const { ref, onKeyDown } = useMenuKeys();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <p className="px-2 pb-1 pt-1 text-[11px] text-fg-subtle">Set status</p>
      <ul ref={ref} role="menu" aria-label="Truck status" onKeyDown={onKeyDown} className="space-y-px">
        {truckStatusChoices(status).map((s) => (
          <li key={s} role="none">
            <button type="button" role="menuitem" disabled={pending || s === status} onClick={() => { setError(null); pick(s, setError); }}
              className={cn(menuItemClass, s === status && "bg-raised font-medium")}>
              <StatusDot tone={STATUS_TONE[truckStatusTone(s, hasDriver)] ?? "neutral"} />
              <span className="flex-1">{truckStatusLabel(s, hasDriver)}</span>
              <span className="text-[10px] text-fg-subtle">{s === status ? "current" : TRUCK_STATUS_HINT[s]}</span>
            </button>
          </li>
        ))}
        <li role="none" className="mt-1 border-t border-line pt-1">
          <button type="button" role="menuitemcheckbox" aria-checked={isVendor} disabled={pending} onClick={() => { setError(null); toggleVendor(setError); }} className={menuItemClass}>
            <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", isVendor ? "border-progress bg-progress text-white" : "border-line-strong")}>
              {isVendor && <Check className="h-2.5 w-2.5" />}
            </span>
            <span className="flex-1">Vendor truck</span>
            <span className="text-[10px] text-fg-subtle">another owner&apos;s</span>
          </button>
        </li>
      </ul>
      {error && <p role="alert" className="mt-1 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">{error}</p>}
      <p className="mt-1 border-t border-line px-2 pt-1.5 text-[10px] leading-4 text-fg-subtle">
        {hasDriver ? "Assigned while it has a driver" : "Available until it gets a driver"}. A repair in the shop puts it In shop; completing it brings it back.
      </p>
    </div>
  );
}
