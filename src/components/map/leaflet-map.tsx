"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, Popup, CircleMarker, useMap } from "react-leaflet";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useFormat } from "@/components/locale";

// Default: OpenStreetMap (fine for dev/low volume). For production traffic set a
// commercial tile provider via NEXT_PUBLIC_MAP_TILE_URL (e.g. MapTiler, Mapbox, Stadia).
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Marker fill. Without it the marker follows `status` / `moving` (in service = warn, moving = progress, else info). */
export type MapTone = "progress" | "info" | "warn" | "danger" | "ok" | "neutral";

export type MapTruck = {
  id: string;
  unitNumber: string;
  lat: number | null;
  lng: number | null;
  heading: number;
  speedKmh: number;
  status: string;
  driverName?: string | null;
  label?: string;
  /** Optional path drawn as a dashed line under the marker. */
  route?: [number, number][];
  moving?: boolean;
  /** GPS fix is old — marker is faded with a dashed ring. */
  stale?: boolean;
  tone?: MapTone;
  /** "stop": out of service (defect hold) — a stop sign instead of the truck, so it reads without colour. */
  glyph?: "truck" | "stop";
};

/** Where the map opens before it knows any position: the company's part of the world, from its time zone. */
function defaultView(tz: string): { center: [number, number]; zoom: number } {
  if (tz.startsWith("America/")) return { center: [39.5, -96], zoom: 4 };
  if (tz.startsWith("Europe/")) return { center: [50, 10], zoom: 4 };
  return { center: [41.3, 69.24], zoom: 6 };
}

export type MapPointKind = "origin" | "dest" | "stop";
export type MapPoint = {
  lat: number;
  lng: number;
  label: string;
  kind: MapPointKind;
  /** Completed stop — drawn faded. */
  done?: boolean;
  /** Stop number; when set the point renders as a numbered marker. */
  index?: number;
};

/* ------------------------------------------------------------------ */
/* Theme tokens, read from CSS variables at render                      */
/* ------------------------------------------------------------------ */

const VARS = ["--accent", "--on-accent", "--info", "--progress", "--warn", "--danger", "--ok", "--fg", "--fg-muted", "--fg-subtle", "--surface", "--primary", "--on-primary"] as const;
type Vars = Record<(typeof VARS)[number], string>;

const FALLBACK = Object.fromEntries(VARS.map((v) => [v, `var(${v})`])) as Vars;
let cached: { mode: string; vars: Vars } | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

const mode = () => `${document.documentElement.getAttribute("data-theme") ?? ""}|${document.documentElement.getAttribute("data-accent") ?? ""}`;
function read(): Vars {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim() || `var(${v})`])) as Vars;
}
function getSnapshot(): Vars {
  if (!cached || cached.mode !== mode()) cached = { mode: mode(), vars: read() };
  return cached.vars;
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!observer) {
    observer = new MutationObserver(() => { cached = { mode: mode(), vars: read() }; listeners.forEach((l) => l()); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) { observer?.disconnect(); observer = null; cached = null; }
  };
}
/** Marker colours flip with the theme toggle (Leaflet paints SVG attributes, so var() alone is not enough). */
const useThemeVars = () => useSyncExternalStore(subscribe, getSnapshot, () => FALLBACK);

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

const TONE_VAR: Record<MapTone, (typeof VARS)[number]> = {
  progress: "--progress", info: "--info", warn: "--warn", danger: "--danger", ok: "--ok", neutral: "--fg-muted",
};

/** An explicit tone wins; otherwise moving = progress, idle = info, in service = warn. Selected = accent. */
function truckColor(t: MapTruck, selected: boolean, v: Vars) {
  if (selected) return { fill: v["--accent"], ink: v["--on-accent"] };
  const fill = t.tone ? v[TONE_VAR[t.tone]] : t.status !== "ACTIVE" ? v["--warn"] : t.moving ? v["--progress"] : v["--info"];
  // Surface colour as the glyph ink: white on the deep day fills, graphite on the light night fills.
  return { fill, ink: v["--surface"] };
}

// Leaflet rebuilds a marker's DOM whenever its icon object changes. Polls (10 s) and clock ticks re-render the map,
// so icons are reused while everything they draw (colours resolved from the theme included) is unchanged.
const iconCache = new Map<string, L.DivIcon>();
function cachedIcon(key: string, build: () => L.DivIcon) {
  let icon = iconCache.get(key);
  if (!icon) {
    if (iconCache.size > 500) iconCache.clear();
    icon = build();
    iconCache.set(key, icon);
  }
  return icon;
}

function truckIcon(t: MapTruck, selected: boolean, v: Vars) {
  const { fill, ink } = truckColor(t, selected, v);
  const heading = Math.round(t.heading / 5) * 5; // 5° steps: invisible on screen, keeps the cache warm
  const key = ["t", t.unitNumber, selected, t.moving, t.stale, t.glyph, heading, fill, ink, v["--surface"], v["--fg"]].join("|");
  return cachedIcon(key, () => buildTruckIcon(t, selected, heading, fill, ink, v));
}

const TRUCK_GLYPH = `<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>`;
/** Octagon with a cross: out of service. */
const STOP_GLYPH = `<path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>`;

function buildTruckIcon(t: MapTruck, selected: boolean, heading: number, fill: string, ink: string, v: Vars) {
  const size = selected ? 36 : 28;
  const ring = `2px ${t.stale ? "dashed" : "solid"} ${v["--surface"]}`;
  return L.divIcon({
    className: "truck-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:9999px;background:${fill};border:${ring};box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;${t.stale ? "opacity:.6;" : ""}">
      ${t.moving ? `<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%) rotate(${heading}deg);transform-origin:50% ${size / 2 + 8}px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid ${fill}"></div>` : ""}
      <svg width="${Math.round(size * 0.52)}" height="${Math.round(size * 0.52)}" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${t.glyph === "stop" ? STOP_GLYPH : TRUCK_GLYPH}</svg>
    </div>
    <div style="position:absolute;top:${size + 3}px;left:50%;transform:translateX(-50%);background:${v["--fg"]};color:${v["--surface"]};font-family:var(--font-mono),ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:-.01em;padding:1px 5px;border-radius:4px;white-space:nowrap;${t.stale ? "opacity:.7;" : ""}">${escapeHtml(t.unitNumber)}</div>`,
  });
}

/** origin = info, destination = accent, intermediate stop = graphite. */
function pointColor(p: MapPoint, v: Vars) {
  if (p.kind === "origin") return { fill: v["--info"], ink: v["--surface"] };
  if (p.kind === "dest") return { fill: v["--accent"], ink: v["--on-accent"] };
  return { fill: v["--fg-muted"], ink: v["--surface"] };
}

function stopIcon(p: MapPoint, v: Vars) {
  const { fill, ink } = pointColor(p, v);
  const key = ["s", p.index, p.kind, p.done, fill, ink, v["--surface"]].join("|");
  return cachedIcon(key, () => buildStopIcon(p, fill, ink, v));
}

function buildStopIcon(p: MapPoint, fill: string, ink: string, v: Vars) {
  const size = 22;
  return L.divIcon({
    className: "truck-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${fill};color:${ink};border:2px solid ${v["--surface"]};box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono),ui-monospace,monospace;font-size:11px;font-weight:600;${p.done ? "opacity:.45;" : ""}">${p.index}</div>`,
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/* ------------------------------------------------------------------ */
/* Map behaviour                                                       */
/* ------------------------------------------------------------------ */

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const fit = () => {
      if (points.length === 1) map.setView(points[0], 9);
      else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 10 });
    };
    fit();
    // The container can mount at 0px (hidden tab, flex/calc heights). Re-measure on
    // every resize, and refit when it grows from "too small to be useful".
    let wasTiny = map.getSize().x < 50 || map.getSize().y < 50;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      const s = map.getSize();
      const tiny = s.x < 50 || s.y < 50;
      if (wasTiny && !tiny) fit();
      wasTiny = tiny;
    });
    ro.observe(map.getContainer());
    return () => ro.disconnect();
    // Only refit when the "subject" changes, not on every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    // Aim a bit right of the truck so it stays visible beside the detail panel.
    const zoom = Math.max(map.getZoom(), 8);
    const center = map.unproject(map.project(target, zoom).add([Math.min(170, map.getSize().x / 4), 0]), zoom);
    map.flyTo(center, zoom, { duration: 0.8 });
  }, [target, map]);
  return null;
}

export default function LeafletMap({ trucks = [], points = [], selectedId, onSelect, renderPopup, height = 520, fitKey = "all", flyTo = null, className, center, zoom }: {
  trucks?: MapTruck[];
  points?: MapPoint[];
  selectedId?: string | null;
  /** Marker click selects instead of opening a popup. */
  onSelect?: (id: string) => void;
  /** Popup body for a truck marker (when there is no `onSelect`); defaults to unit, driver, label and speed. */
  renderPopup?: (id: string) => ReactNode;
  height?: number | string;
  /** Refit bounds when this changes (not on every position tick). */
  fitKey?: string;
  flyTo?: [number, number] | null;
  className?: string;
  /** Opening view before any position is known (defaults to the company's region, from its time zone). */
  center?: [number, number];
  zoom?: number;
}) {
  const v = useThemeVars();
  const f = useFormat();
  const start = defaultView(f.tz);
  const positioned = trucks.filter((t) => t.lat != null && t.lng != null);
  const all: [number, number][] = [
    ...positioned.map((t) => [t.lat!, t.lng!] as [number, number]),
    ...points.map((p) => [p.lat, p.lng] as [number, number]),
  ];

  return (
    <div style={{ height }} className={`overflow-hidden rounded-lg ${className ?? ""}`}>
      <MapContainer center={center ?? start.center} zoom={zoom ?? start.zoom} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <FitBounds points={all} fitKey={fitKey} />
        <FlyTo target={flyTo} />
        {positioned.map((t) => {
          if (!t.route) return null;
          const selected = t.id === selectedId;
          return (
            <Polyline key={`r-${t.id}`} positions={t.route}
              pathOptions={{ color: selected ? v["--accent"] : v["--fg-subtle"], weight: selected ? 3 : 2, dashArray: "6 6", opacity: selected ? 0.95 : 0.8 }} />
          );
        })}
        {points.map((p, i) => {
          const { fill } = pointColor(p, v);
          return p.index != null ? (
            <Marker key={`p-${i}`} position={[p.lat, p.lng]} icon={stopIcon(p, v)} zIndexOffset={p.done ? -100 : 100}>
              <Popup>{p.label}</Popup>
            </Marker>
          ) : (
            <CircleMarker key={`p-${i}`} center={[p.lat, p.lng]} radius={7}
              pathOptions={{ color: v["--surface"], weight: 2, fillColor: fill, fillOpacity: p.done ? 0.35 : 1, opacity: p.done ? 0.6 : 1 }}>
              <Popup>{p.label}</Popup>
            </CircleMarker>
          );
        })}
        {positioned.map((t) => (
          <Marker key={t.id} position={[t.lat!, t.lng!]} icon={truckIcon(t, t.id === selectedId, v)}
            eventHandlers={{ click: () => onSelect?.(t.id) }} zIndexOffset={t.id === selectedId ? 1000 : 0}>
            {!onSelect && (renderPopup ? (
              <Popup minWidth={232} maxWidth={300}>{renderPopup(t.id)}</Popup>
            ) : (
              <Popup>
                <div className="text-[12px] leading-4">
                  <b className="num">{t.unitNumber}</b>
                  {t.driverName && <div>{t.driverName}</div>}
                  {t.label && <div className="text-fg-muted">{t.label}</div>}
                  <div className="num text-fg-muted">{f.speed(t.speedKmh)}</div>
                </div>
              </Popup>
            ))}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
