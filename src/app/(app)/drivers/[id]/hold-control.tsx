"use client";

import { useState, useTransition } from "react";
import { PauseCircle, PlayCircle } from "lucide-react";
import { setDriverHold } from "@/app/actions/people";
import { buttonClass, cn, inputClass } from "@/components/ui";
import { Popover } from "../menu";

/**
 * Header control. Not on hold → "Hold" opens a one-field popover (reason) → setDriverHold(id, true, reason).
 * On hold → "Release" confirms in the same popover (shows the current reason) → setDriverHold(id, false).
 */
export function HoldControl({ id, name, hold, reason }: { id: string; name: string; hold: boolean; reason: string | null }) {
  return (
    <Popover width={288} align="end" trigger={({ open, toggle }) => (
      <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} className={cn(buttonClass("secondary"), open && "bg-raised")}>
        {hold ? <><PlayCircle className="text-ok" />Release hold</> : <><PauseCircle className="text-warn" />Hold</>}
      </button>
    )}>
      {(close) => <HoldPanel id={id} name={name} hold={hold} reason={reason} close={close} />}
    </Popover>
  );
}

function HoldPanel({ id, name, hold, reason, close }: { id: string; name: string; hold: boolean; reason: string | null; close: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");

  const run = (next: boolean) => start(async () => {
    setError(null);
    try { await setDriverHold(id, next, next ? text.trim() || null : null); close(); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : "Could not update the hold"); }
  });

  if (hold) {
    return (
      <div className="p-2">
        <p className="text-[12px] font-medium text-fg">Release {name} back to dispatch?</p>
        <p className="mt-1 text-[11px] text-fg-muted">Current reason: <span className="text-fg">{reason ?? "none given"}</span></p>
        {error && <p role="alert" className="mt-2 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">{error}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button type="button" onClick={close} className={buttonClass("ghost", "sm")}>Keep hold</button>
          <button type="button" disabled={pending} onClick={() => run(false)} className={buttonClass("primary", "sm")}>{pending ? "Releasing…" : "Release"}</button>
        </div>
      </div>
    );
  }
  return (
    <form className="p-2" onSubmit={(e) => { e.preventDefault(); run(true); }}>
      <p className="text-[12px] font-medium text-fg">Place {name} on hold</p>
      <p className="mt-1 text-[11px] text-fg-muted">Dispatchers can no longer assign loads; the board shows a HOLD flag with this reason.</p>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason — licence renewal, safety review…" aria-label="Hold reason"
        className={cn(inputClass, "mt-2 h-7 text-[12px]")} />
      {error && <p role="alert" className="mt-2 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={close} className={buttonClass("ghost", "sm")}>Cancel</button>
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>{pending ? "Saving…" : "Place on hold"}</button>
      </div>
    </form>
  );
}
