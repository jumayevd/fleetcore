"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { cn } from "@/components/ui";
import { FLAT_TRUCKS, PLANS, monthlyPrice } from "@/lib/site";

const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: v % 1 ? 2 : 0 });

/** Slide to your fleet size and see what each plan costs a month. */
export function PriceCalculator() {
  const [trucks, setTrucks] = useState(25);
  const pct = ((trucks - 1) / (150 - 1)) * 100;
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-fg-muted">How many trucks do you run?</p>
          <p className="mt-1 flex items-center gap-2 text-[34px] font-semibold leading-none tracking-tight">
            <Truck className="h-7 w-7 text-accent" />{trucks}{trucks === 150 && "+"} <span className="text-[15px] font-normal text-fg-subtle">trucks</span>
          </p>
        </div>
        <p className="text-[13px] text-fg-subtle">{trucks <= FLAT_TRUCKS ? `Flat price up to ${FLAT_TRUCKS} trucks` : `${trucks} trucks × per-truck price`}</p>
      </div>
      <input type="range" min={1} max={150} value={trucks} onChange={(e) => setTrucks(Number(e.target.value))} aria-label="Number of trucks"
        className="mt-6 h-2 w-full cursor-pointer appearance-none rounded-full accent-[var(--accent)]"
        style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--sunken) ${pct}%)` }} />
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-faint"><span>1 truck</span><span>150+ trucks</span></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {PLANS.map((p) => (
          <div key={p.id} className={cn("rounded-xl border px-5 py-4", p.popular ? "border-accent/50 bg-accent-soft" : "border-line bg-raised")}>
            <p className="text-[13px] font-medium text-fg-muted">{p.name}</p>
            <p className="mt-1 text-[28px] font-semibold tracking-tight">{money(monthlyPrice(p, trucks))}<span className="text-[14px] font-normal text-fg-muted"> / month</span></p>
            <p className="text-[12px] text-fg-subtle">{trucks <= FLAT_TRUCKS ? `${money(p.flat)} flat for up to ${FLAT_TRUCKS} trucks` : `${money(p.perTruck)} × ${trucks} trucks`}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
