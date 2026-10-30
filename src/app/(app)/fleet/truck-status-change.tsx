"use client";

import { useState, useTransition } from "react";
import { Wrench } from "lucide-react";
import { INACTIVE_REASONS, INACTIVE_REASON_LABELS, IN_SHOP_REASONS } from "@/lib/constants";
import { roLabel } from "@/lib/service";
import { Button, Input, LinkButton, Textarea, cn } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import { Overlay } from "@/components/inspections/overlay";
import { startRepair } from "@/app/actions/repairs";
import { setTruckStatus } from "./actions";

/** A repair order booked for the truck that has not gone in yet ("check in" puts the truck In shop). */
export type ScheduledRepair = { id: string; number: number; title: string; when: string };

export type TruckStatusTarget = { id: string; unitNumber: string; hasDriver: boolean; today: string; scheduled: ScheduledRepair[] };

/** What the details box suggests writing down, by reason. */
const DETAIL_HINT: Record<string, string> = {
  SOLD: "Buyer, price, bill of sale…", ACCIDENT: "Where it happened, claim number…", STOLEN: "Police report number, where it was taken from…",
  TOTAL_LOSS: "Insurance claim number, adjuster…", RETURNED: "Returned to (lessor or owner), return paperwork…",
  MECHANICAL: "What failed, the shop's estimate…", OTHER: "Why it is inactive",
};

/**
 * One way to change a truck's status, for the pill on the trucks list and the menu on the truck page. Available and
 * Vendor apply at once; Inactive asks why first; In shop asks why and then needs a repair order: a new one (the
 * truck goes In shop when it is saved) or checking in one already booked. `pick` returns an error to show, if any.
 */
export function useTruckStatusChange(t: TruckStatusTarget) {
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<"INACTIVE" | "MAINTENANCE" | null>(null);
  const pick = (status: string, onDone: (error: string | null) => void) => {
    if (status === "INACTIVE" || status === "MAINTENANCE") {
      setAsking(status);
      onDone(null);
      return;
    }
    start(async () => {
      try {
        const res = await setTruckStatus(t.id, status);
        onDone(res?.error ?? null);
      } catch {
        onDone("Could not change the status. Refresh the page and try again.");
      }
    });
  };
  const close = () => setAsking(null);
  // The dialogs render into <body>, but React still bubbles their clicks to the list row, which would open the truck.
  const dialogs = (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      {asking === "INACTIVE" && <InactiveDialog t={t} onClose={close} />}
      {asking === "MAINTENANCE" && <ShopDialog t={t} onClose={close} />}
    </span>
  );
  return { pick, pending, dialogs };
}

function Choice({ name, value, checked, onPick, children }: { name: string; value: string; checked: boolean; onPick: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
      checked ? "border-accent/60 bg-accent-soft text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onPick(value)} className="accent-[var(--accent)]" />
      {children}
    </label>
  );
}

function InactiveDialog({ t, onClose }: { t: TruckStatusTarget; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(t.today);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(reason) && Boolean(date) && (reason !== "OTHER" || Boolean(note.trim()));
  const submit = () => start(async () => {
    setError(null);
    try {
      const res = await setTruckStatus(t.id, "INACTIVE", { reason, note, date });
      if (res?.error) setError(res.error);
      else onClose();
    } catch {
      setError("Could not save. Refresh the page and try again.");
    }
  });
  return (
    <Overlay variant="dialog" onClose={onClose} title={`Set ${t.unitNumber} inactive`} subtitle="Why it is leaving the fleet"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || !ready} onClick={submit}>{pending ? "Saving…" : "Set inactive"}</Button>
        </div>
      }>
      <fieldset>
        <legend className="mb-1.5 text-[12px] font-medium text-fg-muted">Reason <span className="text-danger">*</span></legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {INACTIVE_REASONS.map((r) => <Choice key={r} name="reason" value={r} checked={reason === r} onPick={setReason}>{INACTIVE_REASON_LABELS[r]}</Choice>)}
        </div>
      </fieldset>
      <label className="mt-4 block">
        <span className="mb-1 block text-[12px] font-medium text-fg-muted">Since <span className="text-danger">*</span></span>
        <Input type="date" value={date} max={t.today} onChange={(e) => setDate(e.target.value)} className="w-44" />
      </label>
      <label className="mt-4 block">
        <span className="mb-1 block text-[12px] font-medium text-fg-muted">Details{reason === "OTHER" ? <span className="text-danger"> *</span> : " (optional)"}</span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder={DETAIL_HINT[reason] ?? "Anything to keep on record"} />
      </label>
      <p className="mt-3 text-[12px] text-fg-subtle">
        {t.hasDriver ? "Its driver comes off the truck on that day. " : ""}It stops counting in the fleet until it is set back to Available.
      </p>
      {error && <FormMessage tone="error" className="mt-3">{error}</FormMessage>}
    </Overlay>
  );
}

function ShopDialog({ t, onClose }: { t: TruckStatusTarget; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const checkIn = (ro: ScheduledRepair) => start(async () => {
    setError(null);
    try {
      const res = await startRepair(ro.id);
      if (res?.error) setError(res.error);
      else onClose();
    } catch {
      setError("Could not check it in. Refresh the page and try again.");
    }
  });
  const href = `/maintenance/work-orders/new?truck=${t.id}&type=${reason}&status=IN_PROGRESS`;
  return (
    <Overlay variant="dialog" onClose={onClose} title={`Put ${t.unitNumber} in the shop`} subtitle="In shop always has a repair order"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {reason
            ? <LinkButton href={href}><Wrench />Create repair order</LinkButton>
            : <Button disabled title="Pick the reason first"><Wrench />Create repair order</Button>}
        </div>
      }>
      <fieldset>
        <legend className="mb-1.5 text-[12px] font-medium text-fg-muted">Reason <span className="text-danger">*</span></legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {IN_SHOP_REASONS.map((r) => <Choice key={r.value} name="shopReason" value={r.value} checked={reason === r.value} onPick={setReason}>{r.label}</Choice>)}
        </div>
      </fieldset>
      <p className="mt-3 text-[12px] text-fg-subtle">
        Next comes the repair order: the shop, what needs doing and when it went in. {t.unitNumber} goes In shop when the order is created,
        and back to {t.hasDriver ? "Assigned" : "Available"} when the repair is completed.
      </p>
      {t.scheduled.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-1.5 text-[12px] font-medium text-fg-muted">Or check in a repair already booked</p>
          <ul className="space-y-1.5">
            {t.scheduled.map((ro) => (
              <li key={ro.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate"><span className="num font-medium text-fg">{roLabel(ro.number)}</span> <span className="text-fg-muted">· {ro.title} · booked {ro.when}</span></span>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => checkIn(ro)}>{pending ? "Saving…" : "Check in"}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <FormMessage tone="error" className="mt-3">{error}</FormMessage>}
    </Overlay>
  );
}
