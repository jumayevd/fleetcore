"use client";

import { useSyncExternalStore } from "react";
import { getFix, subscribeFix } from "./geo-store";

/** Hidden lat/lng inputs, filled while location sharing is on, so Start trip / Confirm delivery record where they happened. */
export function GeoFields() {
  const fix = useSyncExternalStore(subscribeFix, getFix, () => null);
  if (!fix) return null;
  return (
    <>
      <input type="hidden" name="lat" value={String(fix.lat)} />
      <input type="hidden" name="lng" value={String(fix.lng)} />
    </>
  );
}
