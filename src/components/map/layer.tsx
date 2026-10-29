"use client";

import { useSyncExternalStore } from "react";
import { Map as MapIcon, Satellite } from "lucide-react";
import { IconButton, cn } from "@/components/ui";

/*
 * Street map or satellite, remembered in this browser (localStorage) and shared by every map on the page. Storage can
 * be missing or throw (private windows, blocked site data): then the choice lasts until the page is reloaded.
 */
export type MapLayer = "map" | "satellite";

const KEY = "fleetcore:map.layer";
let memory: MapLayer | null = null;
const listeners = new Set<() => void>();

const isLayer = (v: unknown): v is MapLayer => v === "map" || v === "satellite";

function read(): MapLayer {
  try {
    const v = window.localStorage.getItem(KEY);
    if (isLayer(v)) return v;
  } catch {
    // Storage unavailable: fall back to this visit's choice.
  }
  return memory ?? "map";
}

function write(layer: MapLayer) {
  memory = layer;
  try {
    window.localStorage.setItem(KEY, layer);
  } catch {
    // Storage unavailable: the in-memory copy above keeps the choice for this visit.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key == null || e.key === KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

export function useMapLayer(): [MapLayer, (layer: MapLayer) => void] {
  return [useSyncExternalStore(subscribe, read, () => "map"), write];
}

/** Square button that flips the maps between the street map and satellite imagery. */
export function MapLayerButton({ className }: { className?: string }) {
  const [layer, setLayer] = useMapLayer();
  const satellite = layer === "satellite";
  return (
    <IconButton label={satellite ? "Street map" : "Satellite view"} aria-pressed={satellite} onClick={() => setLayer(satellite ? "map" : "satellite")}
      className={cn("border border-line bg-overlay shadow-float hover:bg-raised", className)}>
      {satellite ? <MapIcon /> : <Satellite />}
    </IconButton>
  );
}
