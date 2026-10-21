"use client";

import { useState, useSyncExternalStore } from "react";
import { UNIT_SYSTEMS, guessLocale, zoneCity, type UnitSystem } from "@/lib/locale";
import { cn, segmentedThumb, segmentedTrack } from "@/components/ui";

const noop = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";

/**
 * Units for a new company, defaulting from this browser's time zone (US → miles, elsewhere → kilometres), plus the
 * time zone itself as a hidden field. Both can be changed later under Company profile → Region & units.
 */
export function RegionPicker({ className }: { className?: string }) {
  const tz = useSyncExternalStore(noop, browserZone, () => "");
  const [picked, setPicked] = useState<UnitSystem | null>(null);
  const units = picked ?? (tz ? guessLocale(tz).units : "imperial");
  const hint = UNIT_SYSTEMS.find((u) => u.value === units)?.hint;

  return (
    <div className={className}>
      <input type="hidden" name="units" value={units} />
      <input type="hidden" name="timezone" value={tz} />
      <span className="mb-1 block text-[12px] font-medium text-fg-muted">Units</span>
      <div className={cn(segmentedTrack, "w-full")} role="radiogroup" aria-label="Units">
        {UNIT_SYSTEMS.map((u) => (
          <button key={u.value} type="button" role="radio" aria-checked={units === u.value} onClick={() => setPicked(u.value)}
            className={cn(segmentedThumb(units === u.value), "flex-1 justify-center")}>
            {u.label}
          </button>
        ))}
      </div>
      <span className="mt-1 block text-[11px] text-fg-subtle">
        {hint}{tz && <> · time zone {zoneCity(tz)}</>} · change any time in Company profile
      </span>
    </div>
  );
}
