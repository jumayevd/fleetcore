"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeftRight, Unlink } from "lucide-react";
import { assignTruck } from "@/app/actions/drivers";
import { FormMessage } from "@/components/forms";
import { buttonClass, cn, inputClass } from "@/components/ui";

type Option = { value: string; label: string };

/**
 * Give the driver a truck, swap it, or take it away → assignTruck(driverId, truckId | null).
 * `options` are trucks without a driver (one driver per truck), never the current one.
 */
export function TruckAssignment({ driverId, driverName, current, options }: {
  driverId: string; driverName: string; current: { id: string; unitNumber: string } | null; options: Option[];
}) {
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(!current);
  const [confirming, setConfirming] = useState(false);
  const [choice, setChoice] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const run = (truckId: string | null) => start(async () => {
    setMsg(null);
    try {
      const res = await assignTruck(driverId, truckId);
      if (res?.error) { setMsg({ tone: "error", text: res.error }); return; }
      setMsg(res?.ok && res.ok !== "No change" ? { tone: "ok", text: res.ok } : null);
      setConfirming(false);
      setChoice("");
      setPicking(!truckId);
    } catch {
      setMsg({ tone: "error", text: "Could not change the truck. Try again." });
    }
  });

  const message = msg && <FormMessage tone={msg.tone} className="mt-3">{msg.text}</FormMessage>;

  if (current && !picking) {
    return (
      <div>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-raised px-3 py-2">
            <p className="flex-1 text-[12px] text-fg">Take <span className="num font-medium">{current.unitNumber}</span> away from {driverName}? The truck stays in the fleet without a driver.</p>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass("ghost", "sm")}>Cancel</button>
            <button type="button" disabled={pending} onClick={() => run(null)} className={buttonClass("secondary", "sm")}>{pending ? "Unassigning…" : "Unassign"}</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setMsg(null); setPicking(true); }} className={buttonClass("secondary", "sm")} disabled={options.length === 0}
              title={options.length === 0 ? "Every other truck already has a driver" : undefined}>
              <ArrowLeftRight />Change truck
            </button>
            <button type="button" onClick={() => { setMsg(null); setConfirming(true); }} className={buttonClass("ghost", "sm")}><Unlink />Unassign</button>
          </div>
        )}
        {message}
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div>
        <p className="text-[12px] text-fg-muted">
          Every truck already has a driver. Unassign one on its driver&apos;s page, or <Link href="/fleet/new" className="font-medium text-fg hover:underline">add a truck</Link>.
        </p>
        {current && <button type="button" onClick={() => setPicking(false)} className={cn(buttonClass("ghost", "sm"), "mt-2")}>Cancel</button>}
        {message}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (choice) run(choice); }}>
      <div className="flex flex-wrap items-center gap-2">
        <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Truck" className={cn(inputClass, "w-auto min-w-56 flex-1 pr-7")}>
          <option value="">{current ? "Pick another truck…" : "Pick a truck without a driver…"}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="submit" disabled={!choice || pending} className={buttonClass("primary")}>{pending ? "Assigning…" : current ? "Swap truck" : "Assign truck"}</button>
        {current && <button type="button" onClick={() => { setPicking(false); setChoice(""); }} className={buttonClass("ghost")}>Cancel</button>}
      </div>
      <p className="mt-1.5 text-[11px] text-fg-subtle">Only trucks without a driver are listed.{current && ` ${current.unitNumber} is freed when you swap.`}</p>
      {message}
    </form>
  );
}
