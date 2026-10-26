"use client";

import { useState, useTransition } from "react";
import { cn, inputClass } from "@/components/ui";
import { matchEldUnit, setEldTimeBasis } from "@/app/actions/eld";

/** Which FleetCore truck an ELD vehicle is: matched automatically, picked by hand, or none. Saves on change. */
export function MatchSelect({ unitId, value, mode, trucks, label }: {
  unitId: string; value: string | null; mode: string; trucks: { id: string; unitNumber: string; taken: boolean }[]; label: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = mode === "AUTO" ? "auto" : value ?? "none";
  return (
    <span className="inline-flex flex-col">
      <select value={current} disabled={pending} aria-label={label}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            setError(null);
            const res = await matchEldUnit(unitId, next).catch(() => ({ error: "Could not save. Try again." }));
            if (res?.error) setError(res.error);
          });
        }}
        className={cn(inputClass, "h-7 w-48 text-[12px]", current === "none" && "text-fg-subtle")}>
        <option value="auto">Match automatically</option>
        <option value="none">Not in FleetCore</option>
        <optgroup label="Pick a truck">
          {trucks.map((t) => <option key={t.id} value={t.id}>{t.unitNumber}{t.taken && t.id !== value ? " (linked to another)" : ""}</option>)}
        </optgroup>
      </select>
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}

/** TrackPro sends times without a zone: read them as UTC, as company time, or let the first sync decide. */
export function TimeBasisSelect({ value, zone }: { value: string; zone: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <select value={value} disabled={pending} aria-label="How TrackPro's times read"
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            setError(null);
            const res = await setEldTimeBasis(next).catch(() => ({ error: "Could not save. Try again." }));
            if (res?.error) setError(res.error);
          });
        }}
        className={cn(inputClass, "h-7 w-56 text-[12px]")}>
        <option value="AUTO">Work it out on the next sync</option>
        <option value="UTC">UTC</option>
        <option value="COMPANY">Company time ({zone})</option>
      </select>
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
