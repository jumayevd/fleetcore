"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { format, isSameDay } from "date-fns";
import { ArrowUpRight, Maximize2, MapPin, Phone, Search, X } from "lucide-react";
import { LeafletMap, type MapPoint, type MapTruck } from "./map";
import {
  Avatar, Badge, Chip, EmptyState, IconButton, Kbd, LiveDot, PageHeader, Progress, StatusDot,
  buttonClass, cn, inputClass, type Tone,
} from "./ui";
import { BOARD_STATUS_LABELS, humanize, type BoardStatus } from "@/lib/constants";
import type { FleetSnapshot } from "@/lib/telemetry";

/** The map only re-renders when its props change, not on every keystroke in the search box. */
const MemoMap = memo(LeafletMap);

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

const POLL_MS = 10_000;
const CLOCK_MS = 15_000;
/** Above this the truck is "rolling"; at or below it is idle or stopped. */
const ROLLING_KMH = 5;
/** A GPS fix older than this is "no signal". */
const STALE_MS = 30 * 60_000;
const LOW_FUEL_PCT = 20;
/** ETA inside this margin before the delivery deadline is "tight". */
const TIGHT_ETA_MS = 60 * 60_000;

type Truck = FleetSnapshot[number];
type Stop = NonNullable<Truck["load"]>["stops"][number];
type Motion = "rolling" | "idle" | "stopped";
type Assign = "all" | "loaded" | "unassigned";
type Attention = "all" | "late" | "fuel" | "signal" | "hold";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-muted", accent: "text-accent-text", ok: "text-ok", warn: "text-warn",
  danger: "text-danger", info: "text-info", progress: "text-progress",
};
const MOTION_LABEL: Record<Motion, string> = { rolling: "Rolling", idle: "Idle", stopped: "Stopped" };
const SOURCE_LABEL: Record<string, string> = { SIMULATED: "Route estimate", DEVICE: "Driver app", SAMSARA: "Samsara ELD" };

/* ------------------------------------------------------------------ */
/* Clock store: stable during SSR/hydration, ticks on the client        */
/* ------------------------------------------------------------------ */

const nowListeners = new Set<() => void>();
let nowValue = 0;
let nowTimer: ReturnType<typeof setInterval> | null = null;
const emitNow = () => { nowValue = Date.now(); nowListeners.forEach((l) => l()); };
function subscribeNow(cb: () => void) {
  nowListeners.add(cb);
  if (!nowTimer) nowTimer = setInterval(emitNow, CLOCK_MS);
  return () => {
    nowListeners.delete(cb);
    if (nowListeners.size === 0 && nowTimer) { clearInterval(nowTimer); nowTimer = null; }
  };
}
function getNow() {
  if (!nowValue) nowValue = Date.now();
  return nowValue;
}
/** Wall clock. Renders `fallback` on the server and during hydration so "ago" strings never mismatch. */
const useNow = (fallback: number) => useSyncExternalStore(subscribeNow, getNow, () => fallback);
const noopSubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

/** live: polling · offline: last poll failed, retrying · snapshot: no live updates for this viewer, showing the server render. */
type Feed = "live" | "offline" | "snapshot";

function useFleet(initial: FleetSnapshot, live = true) {
  const [trucks, setTrucks] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [feed, setFeed] = useState<Feed>("live");
  const router = useRouter();

  useEffect(() => {
    if (!live) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function schedule() { timer = setTimeout(tick, POLL_MS); }
    async function tick() {
      // Don't burn requests while the tab is hidden; refresh immediately when it comes back.
      if (document.visibilityState === "hidden") { schedule(); return; }
      try {
        const r = await fetch("/api/fleet", { cache: "no-store" });
        if (!active) return;
        // Session expired: every page would bounce to the login screen, so go there instead of retrying forever.
        if (r.status === 401) { active = false; router.replace("/login"); return; }
        // Signed in but not allowed to track (e.g. the dashboard map for accounting): keep the snapshot, stop asking.
        if (r.status === 403) { active = false; setFeed("snapshot"); return; }
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { trucks: FleetSnapshot };
        if (!active) return;
        setTrucks(data.trucks);
        setUpdatedAt(Date.now());
        setFeed("live");
        emitNow();
      } catch {
        if (active) setFeed("offline");
      }
      if (active) schedule();
    }
    const onVisible = () => {
      if (!active || document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, router]);

  return { trucks, updatedAt, feed: live ? feed : ("snapshot" as Feed) };
}

/* ------------------------------------------------------------------ */
/* Derived view model                                                  */
/* ------------------------------------------------------------------ */

type Eta = { tone: Tone; label: string; at: number; due: number };
type View = {
  t: Truck;
  motion: Motion;
  /** Truck is in maintenance or out of service. */
  inService: boolean;
  fixAgeMs: number | null;
  /** No GPS fix for STALE_MS: position, speed and engine state are last known, not live. */
  stale: boolean;
  /**
   * The one "No signal" predicate (chips, attention filter, dashboard count, faded marker):
   * stale while it matters, i.e. on a load or last reported with the engine running.
   * A parked, unassigned truck that stopped pinging is just parked.
   */
  signalLost: boolean;
  /** First stop not done; the driver is checked in there when its status is ARRIVED. */
  current: Stop | null;
  onSite: boolean;
  lowFuel: boolean;
  eta: Eta | null;
  windowMissed: boolean;
  /** In transit and at the end of the route: waiting on the delivery to be confirmed. */
  arrived: boolean;
  teamKey: string;
  haystack: string;
};

function derive(t: Truck, now: number): View {
  const fixAgeMs = t.lastPingAt ? Math.max(0, now - Date.parse(t.lastPingAt)) : null;
  const stale = fixAgeMs == null || fixAgeMs >= STALE_MS;
  const l = t.load;
  const current = l?.stops.find((s) => s.status !== "DONE") ?? null;
  const onSite = current?.status === "ARRIVED";
  // Staleness wins: an old fix's speed is history, not motion. A truck checked in at a stop is not rolling either,
  // whatever the last simulated speed says.
  const motion: Motion = stale
    ? (t.engineOn ? "idle" : "stopped")
    : t.speedKmh > ROLLING_KMH && !onSite ? "rolling" : "idle";
  let eta: Eta | null = null;
  if (l?.eta && l.status === "IN_TRANSIT") {
    const at = Date.parse(l.eta);
    const due = Date.parse(l.deliveryAt);
    const slack = due - at;
    eta = slack < 0
      ? { tone: "danger", label: `${dur(-slack)} late`, at, due }
      : slack < TIGHT_ETA_MS ? { tone: "warn", label: "tight", at, due } : { tone: "ok", label: "on time", at, due };
  }
  // Once the driver is on site an elapsed window is no longer "late": the truck made it.
  const windowMissed = Boolean(!onSite && l?.nextStop?.windowEnd && Date.parse(l.nextStop.windowEnd) < now);
  return {
    t, motion, fixAgeMs, eta, windowMissed, stale, current, onSite,
    signalLost: stale && (Boolean(l) || t.engineOn),
    arrived: Boolean(l && l.status === "IN_TRANSIT" && l.progress >= 1),
    inService: t.status !== "ACTIVE",
    lowFuel: t.fuelPct != null && t.fuelPct < LOW_FUEL_PCT,
    teamKey: t.driver?.team ?? "none",
    haystack: [
      t.unitNumber, t.plate, t.name, t.driver?.name, t.locationName, l?.reference, l?.customer,
      l?.originCity, l?.destCity, l?.nextStop?.city, l?.nextStop?.name,
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

type Filters = { q: string; motion: "all" | Motion; assign: Assign; team: string; attention: Attention };

function matches(v: View, f: Filters, skip?: keyof Filters) {
  if (skip !== "q" && f.q && !v.haystack.includes(f.q)) return false;
  if (skip !== "motion" && f.motion !== "all" && v.motion !== f.motion) return false;
  if (skip !== "assign") {
    if (f.assign === "loaded" && !v.t.load) return false;
    if (f.assign === "unassigned" && v.t.load) return false;
  }
  if (skip !== "team" && f.team !== "all" && v.teamKey !== f.team) return false;
  if (skip !== "attention" && f.attention !== "all" && !hasAttention(v, f.attention)) return false;
  return true;
}

function hasAttention(v: View, a: Attention) {
  switch (a) {
    case "late": return v.eta?.tone === "danger" || v.windowMissed;
    case "fuel": return v.lowFuel;
    case "signal": return v.signalLost;
    case "hold": return Boolean(v.t.driver?.hold);
    default: return true;
  }
}

const motionTone = (v: View): Tone => (v.inService ? "warn" : v.motion === "rolling" ? "progress" : v.motion === "idle" ? "info" : "neutral");

const toMap = (v: View): MapTruck => {
  const { t } = v;
  return {
    id: t.id, unitNumber: t.unitNumber, lat: t.lat, lng: t.lng, heading: t.heading, speedKmh: t.speedKmh, status: t.status,
    driverName: t.driver?.name, moving: v.motion === "rolling" && !v.stale, stale: v.signalLost,
    route: t.load?.status === "IN_TRANSIT" ? t.load.route : undefined,
    label: (t.load ? `${t.load.reference} · ${t.load.originCity} → ${t.load.destCity}` : MOTION_LABEL[v.motion])
      + (v.signalLost ? " · no signal" : ""),
  };
};

const posOf = (t: Truck | undefined): [number, number] | null => (t && t.lat != null && t.lng != null ? [t.lat, t.lng] : null);
/** "At pickup" / "At delivery" for a truck checked in at its current stop. */
const siteLabel = (s: Stop) => `At ${humanize(s.type).toLowerCase()}`;

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** "35 min", "2 h 15 min", "3 d". */
function dur(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.round(h / 24)} d`;
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
function fixAge(ms: number | null) {
  if (ms == null) return "never";
  if (ms < 60_000) return "just now";
  return `${dur(ms)} ago`;
}
/** Newest GPS fix in a snapshot: stands in for the server clock when no explicit time is given. */
const latestPing = (trucks: FleetSnapshot) => trucks.reduce((m, t) => (t.lastPingAt ? Math.max(m, Date.parse(t.lastPingAt)) : m), 0);
/** Today → "HH:mm", otherwise "dd MMM HH:mm". */
function clock(iso: string | number, now: number) {
  const d = new Date(iso);
  return isSameDay(d, new Date(now)) ? format(d, "HH:mm") : format(d, "dd MMM HH:mm");
}
const boardLabel = (s: string) => BOARD_STATUS_LABELS[s as BoardStatus] ?? humanize(s);

/* ------------------------------------------------------------------ */
/* Small parts                                                         */
/* ------------------------------------------------------------------ */

function Seg<T extends string>({ value, onChange, items, label }: {
  value: T; onChange: (v: T) => void; items: { key: T; label: string; count?: number }[]; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-7 items-center rounded-md border border-line bg-surface p-0.5">
      {items.map((i) => {
        const active = i.key === value;
        return (
          <button key={i.key} type="button" aria-pressed={active} onClick={() => onChange(i.key)}
            className={cn("inline-flex h-6 items-center gap-1 rounded px-2 text-[12px] font-medium transition-colors",
              active ? "bg-primary text-on-primary" : "text-fg-muted hover:text-fg")}>
            {i.label}
            {i.count != null && <span className={cn("num text-[10px]", active ? "opacity-70" : "text-fg-subtle")}>{i.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function FuelBar({ pct, wide }: { pct: number | null; wide?: boolean }) {
  if (pct == null) return <span className="num text-[11px] text-fg-faint">— fuel</span>;
  const low = pct < LOW_FUEL_PCT;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Fuel ${Math.round(pct)}%`}>
      <span className={cn("h-1.5 overflow-hidden rounded-full bg-sunken", wide ? "w-16" : "w-9")}>
        <span className={cn("block h-full rounded-full", low ? "bg-warn" : "bg-fg-subtle")} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </span>
      <span className={cn("num text-[11px]", low ? "font-medium text-warn" : "text-fg-subtle")}>{Math.round(pct)}%</span>
    </span>
  );
}

/** Times are formatted in the viewer's zone; suppress the warning in case server and browser zones differ. */
const T = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span suppressHydrationWarning className={className}>{children}</span>
);

function Metric({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 bg-overlay px-3 py-2">
      <p className="eyebrow truncate">{label}</p>
      <p className={cn("num mt-0.5 truncate text-[13px] font-medium", tone ? TONE_TEXT[tone] : "text-fg")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard mini map                                                  */
/* ------------------------------------------------------------------ */

/**
 * Compact live map with a small legend, for the dashboard.
 * Pass `live={can(user.role, "tracking.view")}`: roles that may see the dashboard but not live tracking get the
 * server snapshot without polling. If omitted it polls and falls back to the snapshot on the first 403.
 */
export function LiveFleetMini({ initial, height = 360, live = true }: { initial: FleetSnapshot; height?: number | string; live?: boolean }) {
  const { trucks, feed } = useFleet(initial, live);
  const now = useNow(latestPing(initial));
  const views = useMemo(() => trucks.map((t) => derive(t, now)), [trucks, now]);
  const mapTrucks = useMemo(() => views.map(toMap), [views]);
  const n = (f: (v: View) => boolean) => views.filter(f).length;
  const signalLost = n((v) => v.signalLost);

  return (
    <div>
      <LeafletMap trucks={mapTrucks} height={height} />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-fg-muted">
        <Legend tone="progress" label="Rolling" count={n((v) => !v.inService && v.motion === "rolling")} />
        <Legend tone="info" label="Idle" count={n((v) => !v.inService && v.motion === "idle")} />
        <Legend tone="info" label="Stopped" count={n((v) => !v.inService && v.motion === "stopped")} faded />
        <Legend tone="warn" label="In service" count={n((v) => v.inService)} />
        <span className="ml-auto flex items-center gap-2">
          {signalLost > 0 && <Chip tone="warn" title="On a load or engine on, but the GPS fix is older than 30 minutes">{signalLost} no signal</Chip>}
          <FeedState feed={feed} compact />
        </span>
      </div>
    </div>
  );
}

/** Connection state only (no timestamp), so it can sit in a polite live region without chattering every poll. */
function FeedState({ feed, compact }: { feed: Feed; compact?: boolean }) {
  if (feed === "offline") {
    return <span className="flex items-center gap-1.5 font-medium text-danger"><StatusDot tone="danger" /> {compact ? "Reconnecting" : "Connection lost, retrying"}</span>;
  }
  if (feed === "snapshot") {
    return <span className="flex items-center gap-1.5 text-fg-subtle" title="Positions as of page load; live updates need access to the live map"><StatusDot /> Snapshot</span>;
  }
  return <LiveDot />;
}

function Legend({ tone, label, count, faded }: { tone: Tone; label: string; count: number; faded?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={tone} className={cn(faded && "opacity-50")} />
      {label} <span className="num font-medium text-fg">{count}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Control tower                                                       */
/* ------------------------------------------------------------------ */

const MOTION_ITEMS: { key: "all" | Motion; label: string }[] = [
  { key: "all", label: "All" }, { key: "rolling", label: "Rolling" }, { key: "idle", label: "Idle" }, { key: "stopped", label: "Stopped" },
];
const ASSIGN_ITEMS: { key: Assign; label: string }[] = [
  { key: "all", label: "All" }, { key: "loaded", label: "On a load" }, { key: "unassigned", label: "Unassigned" },
];
const ATTENTION_ITEMS: { key: Exclude<Attention, "all">; label: string; tone: Tone }[] = [
  { key: "late", label: "Running late", tone: "danger" },
  { key: "signal", label: "No signal", tone: "warn" },
  { key: "fuel", label: "Low fuel", tone: "warn" },
  { key: "hold", label: "On hold", tone: "warn" },
];

/** Full control-tower view: filterable list, live map with routes and stops, detail panel. */
export function TrackingBoard({ initial, at, selectedId: initialSelected }: {
  initial: FleetSnapshot;
  /** Server time of `initial` (ISO). Used as the clock during SSR so nothing mismatches on hydration. */
  at?: string;
  /** Pre-selected truck id (deep link `/tracking?truck=…`). */
  selectedId?: string | null;
}) {
  const { trucks, updatedAt, feed } = useFleet(initial);
  const mounted = useMounted();
  const now = useNow(at ? Date.parse(at) : latestPing(initial));
  const linked = initialSelected ?? null;

  const [q, setQ] = useState("");
  const [motion, setMotion] = useState<"all" | Motion>("all");
  const [assign, setAssign] = useState<Assign>("all");
  const [team, setTeam] = useState("all");
  const [attention, setAttention] = useState<Attention>("all");
  const [selectedId, setSelectedId] = useState<string | null>(linked);
  // A deep link centres on its truck instead of leaving it as a dot under the detail panel.
  const [flyTo, setFlyTo] = useState<[number, number] | null>(() => posOf(initial.find((t) => t.id === linked)));
  const [fitN, setFitN] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Client navigation to another ?truck= re-renders this page with a new prop: follow it
  // (state adjusted during render, React's pattern for props that reset state).
  const [prevLinked, setPrevLinked] = useState(linked);
  if (linked !== prevLinked) {
    setPrevLinked(linked);
    setSelectedId(linked);
    setFlyTo(posOf(trucks.find((t) => t.id === linked)));
  }

  const views = useMemo(() => trucks.map((t) => derive(t, now)), [trucks, now]);
  const filters: Filters = useMemo(() => ({ q: q.trim().toLowerCase(), motion, assign, team, attention }), [q, motion, assign, team, attention]);
  const list = useMemo(() => views.filter((v) => matches(v, filters)), [views, filters]);
  const count = (skip: keyof Filters, pred: (v: View) => boolean) => views.filter((v) => matches(v, filters, skip) && pred(v)).length;

  const teams = useMemo(() => {
    const names = new Set<string>();
    let none = false;
    for (const v of views) { if (v.teamKey === "none") none = true; else names.add(v.teamKey); }
    return { names: [...names].sort(), none };
  }, [views]);

  const selected = useMemo(() => views.find((v) => v.t.id === selectedId) ?? null, [views, selectedId]);
  const filtersActive = filters.q !== "" || motion !== "all" || assign !== "all" || team !== "all" || attention !== "all";

  const select = useCallback((id: string | null, fly = true) => {
    setSelectedId(id);
    const p = fly && id ? posOf(trucks.find((t) => t.id === id)) : null;
    if (p) setFlyTo(p);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("truck", id); else url.searchParams.delete("truck");
      window.history.replaceState(null, "", url);
    }
  }, [trucks]);
  const onMapSelect = useCallback((id: string) => select(id, false), [select]);
  const clearFilters = () => { setQ(""); setMotion("all"); setAssign("all"); setTeam("all"); setAttention("all"); };

  // Keyboard: ↑↓ move through the list, Esc clears search then selection.
  // ("/" and ⌘K are taken by the shell's global search, so they are left alone here.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inSearch = el === searchRef.current;
      const typing = Boolean(el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable));
      if (e.key === "Escape") {
        if (inSearch && q) { setQ(""); return; }
        if (selectedId) { select(null); el?.blur(); }
        return;
      }
      // Arrow keys pan the map while it has focus; leave them to Leaflet there.
      if (el?.closest(".leaflet-container")) return;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (!typing || inSearch) && list.length) {
        e.preventDefault();
        const idx = list.findIndex((v) => v.t.id === selectedId);
        const next = list[e.key === "ArrowDown" ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1)].t.id;
        select(next);
        // Focus follows the selection when it was already in the list, so screen readers announce the new card.
        if (el?.closest("[data-fleet-list]")) document.querySelector<HTMLElement>(`#truck-${CSS.escape(next)} > button`)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, selectedId, q, select]);

  useEffect(() => {
    if (selectedId) document.getElementById(`truck-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const mapTrucks = useMemo(() => views.map(toMap), [views]);
  const points = useMemo<MapPoint[]>(() => (selected?.t.load
    ? selected.t.load.stops.map((s, i, arr) => ({
        lat: s.lat, lng: s.lng, index: i + 1, done: s.status === "DONE",
        label: `${i + 1}. ${s.name} · ${humanize(s.type)}${s.status === "DONE" ? " · done" : ""}`,
        kind: i === 0 ? "origin" : i === arr.length - 1 ? "dest" : "stop",
      }))
    : []), [selected]);

  // Same partition the motion filter uses, so the header and the segment counts always agree.
  const rolling = views.filter((v) => v.motion === "rolling").length;
  const idle = views.filter((v) => v.motion === "idle").length;
  const stopped = views.filter((v) => v.motion === "stopped").length;
  const inService = views.filter((v) => v.inService).length;
  const shownAt = updatedAt ?? (at ? Date.parse(at) : null);

  return (
    <div className="flex flex-col xl:h-[calc(100vh-84px)] xl:min-h-[560px]">
      <PageHeader
        eyebrow="Tracking"
        title="Live map"
        subtitle={
          <span className="num">
            {views.length} trucks · {rolling} rolling · {idle} idle · {stopped} stopped{inService ? ` (${inService} in service)` : ""}
          </span>
        }
        actions={
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[12px]">
            {/* Only the connection state is announced; the timestamp changes every poll and stays out of the live region. */}
            <span role="status" aria-live="polite"><FeedState feed={feed} /></span>
            <span className="text-fg-faint" aria-hidden="true">·</span>
            <span className="num text-fg-muted">
              {mounted && shownAt ? <>Updated <T>{format(shownAt, "HH:mm:ss")}</T></> : `Every ${POLL_MS / 1000} s`}
            </span>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[372px_minmax(0,1fr)]">
        {/* ---------------- List ---------------- */}
        <aside className="isolate flex min-h-0 flex-col rounded-lg border border-line bg-surface xl:max-h-none" aria-label="Fleet list">
          <div className="space-y-2 border-b border-line p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-faint" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Unit, driver, load, city"
                aria-label="Search fleet" className={cn(inputClass, "pl-8 pr-8")} />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1.5 top-1.5 rounded p-0.5 text-fg-subtle hover:bg-raised hover:text-fg"><X className="h-4 w-4" /></button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Seg label="Motion" value={motion} onChange={setMotion}
                items={MOTION_ITEMS.map((i) => ({ ...i, count: i.key === "all" ? undefined : count("motion", (v) => v.motion === i.key) }))} />
              <Seg label="Assignment" value={assign} onChange={setAssign}
                items={ASSIGN_ITEMS.map((i) => ({ ...i, count: i.key === "all" ? undefined : count("assign", (v) => (i.key === "loaded" ? Boolean(v.t.load) : !v.t.load)) }))} />
              {(teams.names.length > 0 || teams.none) && (
                <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team"
                  className={cn(inputClass, "h-7 w-auto min-w-0 py-0 pr-7 text-[12px]", team !== "all" && "border-line-strong text-fg")}>
                  <option value="all">All teams</option>
                  {teams.names.map((n) => <option key={n} value={n}>{n}</option>)}
                  {teams.none && <option value="none">No team</option>}
                </select>
              )}
            </div>
            <AttentionRow value={attention} onChange={setAttention} count={(k) => count("attention", (v) => hasAttention(v, k))} />
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain max-xl:max-h-[46vh]" aria-label="Trucks" data-fleet-list>
            {list.map((v) => (
              <TruckCard key={v.t.id} v={v} now={now} selected={v.t.id === selectedId} onSelect={() => select(v.t.id)} />
            ))}
            {list.length === 0 && (
              <li>
                <EmptyState title={filtersActive ? "No trucks match" : "No trucks are being tracked"}
                  description={filtersActive ? "Clear the search or filters to see the whole fleet." : "Add trucks in Fleet and assign drivers; positions appear here as soon as a load departs or a device pings."}
                  action={filtersActive
                    ? <button type="button" onClick={clearFilters} className={buttonClass("secondary", "sm")}>Clear filters</button>
                    : <Link href="/fleet" className={buttonClass("secondary", "sm")}>Open fleet</Link>} />
              </li>
            )}
          </ul>

          <div className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5 text-[11px] text-fg-subtle">
            <span className="num">{list.length} of {views.length} shown</span>
            <span className="hidden items-center gap-1 sm:flex"><Kbd>↑</Kbd><Kbd>↓</Kbd> move <Kbd className="ml-1">esc</Kbd> clear</span>
          </div>
        </aside>

        {/* ---------------- Map ---------------- */}
        <div className="isolate relative min-h-[440px] overflow-hidden rounded-lg border border-line bg-surface xl:min-h-0">
          <div className="absolute inset-0">
            <MemoMap trucks={mapTrucks} points={points} selectedId={selectedId} onSelect={onMapSelect}
              height="100%" fitKey={`all-${fitN}`} flyTo={flyTo} className="rounded-none" />
          </div>

          <div className="absolute left-3 top-[88px] z-[1001]">
            <IconButton label="Fit all trucks" onClick={() => { setFitN((n) => n + 1); setFlyTo(null); }}
              className="border border-line bg-overlay shadow-float hover:bg-raised"><Maximize2 /></IconButton>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 z-[1001] hidden items-center gap-3 rounded-md border border-line bg-overlay/90 px-2.5 py-1.5 text-[11px] text-fg-muted shadow-float backdrop-blur md:flex">
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="progress" /> Rolling</span>
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="info" /> Idle or stopped</span>
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="warn" /> In service</span>
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="accent" /> Selected</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-fg-subtle" /> In-transit route</span>
            {!selected && <span className="text-fg-subtle">Select a truck for its stops and detail</span>}
          </div>

          {selected && <DetailPanel v={selected} now={now} onClose={() => select(null)} />}
        </div>
      </div>
    </div>
  );
}

function AttentionRow({ value, onChange, count }: { value: Attention; onChange: (a: Attention) => void; count: (k: Exclude<Attention, "all">) => number }) {
  const items = ATTENTION_ITEMS.map((i) => ({ ...i, n: count(i.key) })).filter((i) => i.n > 0 || i.key === value);
  if (items.length === 0) return <p className="px-0.5 text-[11px] text-fg-subtle">No late ETAs, signal gaps, low fuel or holds right now</p>;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Needs attention">
      {items.map((i) => {
        const active = value === i.key;
        return (
          <button key={i.key} type="button" aria-pressed={active} onClick={() => onChange(active ? "all" : i.key)}
            className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition-colors",
              active ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg")}>
            {!active && <StatusDot tone={i.tone} />}
            {i.label}
            <span className={cn("num text-[10px]", active ? "opacity-70" : "text-fg-subtle")}>{i.n}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Truck card                                                          */
/* ------------------------------------------------------------------ */

function TruckCard({ v, now, selected, onSelect }: { v: View; now: number; selected: boolean; onSelect: () => void }) {
  const { t } = v;
  const l = t.load;
  const tone = motionTone(v);
  const speed = Math.round(t.speedKmh);

  return (
    <li id={`truck-${t.id}`}>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className={cn("block w-full border-l-2 px-3 py-2 text-left transition-colors hover:bg-raised focus-visible:outline-none focus-visible:bg-raised",
          selected ? "border-accent bg-accent-soft/50 hover:bg-accent-soft/50" : "border-transparent")}>
        {/* Unit · plate · speed */}
        <div className="flex items-center gap-2">
          <StatusDot tone={tone} pulse={v.motion === "rolling" && !v.inService} />
          <span className="num text-[13px] font-semibold text-fg">{t.unitNumber}</span>
          <span className="num truncate text-[11px] text-fg-subtle">{t.plate}</span>
          <span className="ml-auto shrink-0">
            {v.inService
              ? <Badge value={t.status} />
              : v.motion === "rolling"
                ? <span className="num text-[12px] font-medium text-fg">{speed} <span className="text-[10px] font-normal text-fg-subtle">km/h</span></span>
                : v.arrived
                  ? <span className="text-[11px] font-medium text-ok">At destination</span>
                  : v.onSite && v.current
                    ? <span className="text-[11px] font-medium text-info">{siteLabel(v.current)}</span>
                    : v.stale && speed > ROLLING_KMH
                      ? <span className="text-[11px] text-fg-subtle">Last known <span className="num">{speed}</span> km/h</span>
                      : <span className="text-[11px] text-fg-subtle">{v.motion === "idle" ? (t.engineOn ? "Idle · engine on" : "Idle") : "Stopped"}</span>}
          </span>
        </div>

        {/* Driver · hold · board status */}
        <div className="mt-1 flex items-center gap-1.5">
          <span className={cn("truncate text-[12px]", t.driver ? "text-fg-muted" : "text-fg-faint")}>{t.driver?.name ?? "No driver"}</span>
          {t.driver?.hold && <Chip tone="warn" title="Driver is on hold">Hold</Chip>}
          {t.driver && <Badge value={t.driver.boardStatus} label={boardLabel(t.driver.boardStatus)} className="ml-auto" />}
        </div>

        {/* Location · fuel · fix age */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{t.locationName ?? (t.lat == null ? "No position" : "Between cities")}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <FuelBar pct={t.fuelPct} />
            {v.signalLost
              ? <Chip tone="warn" title={`Last fix ${fixAge(v.fixAgeMs)}`}>No signal</Chip>
              : <T className="num">{v.fixAgeMs == null ? "no fix" : v.stale ? `fix ${fixAge(v.fixAgeMs)}` : fixAge(v.fixAgeMs)}</T>}
          </span>
        </div>

        {/* Load */}
        {l && (
          <div className="mt-2 rounded-md border border-line bg-sunken/60 px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-[12px]">
              <span className="num font-medium text-fg">{l.reference}</span>
              <span className="truncate text-fg-muted">{l.originCity} → {l.destCity}</span>
              {l.status !== "IN_TRANSIT" && <Badge value={l.status} label={l.status === "ASSIGNED" ? "Awaiting pickup" : undefined} className="ml-auto" />}
            </div>
            {l.nextStop && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
                <span className="truncate">Next · {humanize(l.nextStop.type)} · {l.nextStop.name}</span>
                {l.nextStop.windowEnd && (
                  <T className={cn("num ml-auto shrink-0", v.windowMissed ? "font-medium text-danger" : "")}>
                    {v.windowMissed ? "window passed " : "by "}{clock(l.nextStop.windowEnd, now)}
                  </T>
                )}
              </div>
            )}
            {l.status === "IN_TRANSIT" && (
              <div className="mt-1.5 flex items-center gap-2">
                <Progress value={l.progress} tone={v.eta?.tone === "danger" ? "danger" : "progress"} className="flex-1" />
                <span className="num w-7 text-right text-[11px] text-fg-subtle">{Math.round(l.progress * 100)}%</span>
                {v.eta && (
                  <T className={cn("num shrink-0 text-[11px] font-medium", TONE_TEXT[v.eta.tone])}>
                    {v.arrived ? "Arrived" : "ETA"} {clock(v.eta.at, now)} · {v.eta.label}
                  </T>
                )}
              </div>
            )}
          </div>
        )}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Detail panel                                                        */
/* ------------------------------------------------------------------ */

function DetailPanel({ v, now, onClose }: { v: View; now: number; onClose: () => void }) {
  const { t } = v;
  const d = t.driver;
  const l = t.load;
  const nextIdx = l ? l.stops.findIndex((s) => s.status !== "DONE") : -1;

  return (
    <section aria-label={`Truck ${t.unitNumber}`}
      className="absolute inset-x-2 bottom-2 z-[1002] flex max-h-[calc(100%-16px)] flex-col overflow-hidden rounded-lg border border-line bg-overlay/95 shadow-float backdrop-blur sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:w-[352px] sm:max-h-[calc(100%-24px)]">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2">
        <StatusDot tone={motionTone(v)} pulse={v.motion === "rolling" && !v.inService} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/fleet/${t.id}`} className="num text-[15px] font-semibold leading-5 text-fg hover:text-accent-text">{t.unitNumber}</Link>
            {v.inService
              ? <Badge value={t.status} />
              : v.arrived
                ? <Badge value="DELIVERED" tone="ok" label="At destination" />
                : v.onSite && v.current
                  ? <Badge value={v.current.status} tone="info" label={siteLabel(v.current)} />
                  : <Badge value={v.motion.toUpperCase()} tone={motionTone(v)} label={MOTION_LABEL[v.motion]} />}
            {v.signalLost && <Chip tone="warn" title={`Last fix ${fixAge(v.fixAgeMs)}`}>No signal</Chip>}
          </div>
          <p className="truncate text-[11px] text-fg-subtle">{t.name} · <span className="num">{t.plate}</span></p>
        </div>
        <IconButton label="Close panel" onClick={onClose}><X /></IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-2 gap-px border-b border-line bg-line">
          <Metric label={v.stale ? "Last known speed" : "Speed"} value={<>{Math.round(t.speedKmh)} <span className="text-[11px] font-normal text-fg-subtle">km/h</span></>}
            hint={v.inService ? humanize(t.status) : v.stale ? "No live data" : t.engineOn ? "Engine on" : "Engine off"} />
          <Metric label="Fuel" value={<FuelBar pct={t.fuelPct} wide />} hint={v.lowFuel ? "Below 20%, plan a fuel stop" : undefined} tone={v.lowFuel ? "warn" : undefined} />
          <Metric label="Location" value={<span className="font-sans">{t.locationName ?? "No position"}</span>}
            hint={t.lat != null && t.lng != null ? `${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}` : undefined} />
          <Metric label="Last ping" value={<T>{fixAge(v.fixAgeMs)}</T>} tone={v.signalLost ? "warn" : undefined}
            hint={t.pingSource ? (SOURCE_LABEL[t.pingSource] ?? humanize(t.pingSource)) : "No device"} />
        </div>

        <div className="flex items-center gap-2.5 border-b border-line px-3 py-2">
          {d ? (
            <>
              <Avatar name={d.name} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link href={`/drivers/${d.id}`} className="truncate text-[13px] font-medium text-fg hover:text-accent-text">{d.name}</Link>
                  {d.hold && <Chip tone="warn" title="Driver is on hold">Hold</Chip>}
                </div>
                <p className="truncate text-[11px] text-fg-subtle">{d.team ?? "No team"} · {boardLabel(d.boardStatus)}</p>
              </div>
              <Badge value={d.boardStatus} label={boardLabel(d.boardStatus)} />
              {d.phone && (
                <a href={`tel:${d.phone.replace(/\s+/g, "")}`} className={buttonClass("secondary", "sm")} title={d.phone}>
                  <Phone /> Call
                </a>
              )}
            </>
          ) : (
            <p className="text-[12px] text-fg-subtle">No driver assigned. <Link href={`/fleet/${t.id}`} className="font-medium text-fg hover:text-accent-text">Assign one on the truck page</Link>.</p>
          )}
        </div>

        {l ? (
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/loads/${l.id}`} className="num text-[13px] font-semibold text-fg hover:text-accent-text">{l.reference}</Link>
              <Badge value={l.status} label={l.status === "ASSIGNED" ? "Awaiting pickup" : undefined} />
            </div>
            <p className="truncate text-[11px] text-fg-subtle">{l.customer}</p>
            <p className="mt-1 text-[13px] text-fg">{l.originCity} → {l.destCity}</p>

            {l.status === "IN_TRANSIT" && (
              <div className="mt-2">
                <Progress value={l.progress} tone={v.eta?.tone === "danger" ? "danger" : "progress"} />
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="num text-fg-subtle">{Math.round(l.progress * 100)}% of route</span>
                  {v.eta && (
                    <T className={cn("num font-medium", TONE_TEXT[v.eta.tone])}>{v.arrived ? "Arrived" : "ETA"} {clock(v.eta.at, now)} · {v.eta.label}</T>
                  )}
                </div>
                {v.eta && (
                  <T className="mt-0.5 block text-[11px] text-fg-subtle">Delivery due <span className="num">{clock(v.eta.due, now)}</span></T>
                )}
              </div>
            )}

            <ol className="mt-2.5 space-y-1.5" aria-label="Stops">
              {l.stops.map((s, i) => {
                const done = s.status === "DONE";
                const next = i === nextIdx;
                return (
                  <li key={i} className={cn("flex items-start gap-2 text-[12px]", done ? "text-fg-faint" : next ? "text-fg" : "text-fg-muted")}>
                    <span className={cn("num mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      done ? "bg-neutral-soft text-fg-faint" : next ? "bg-accent text-on-accent" : "border border-line-strong text-fg-subtle")}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.name}</span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        {humanize(s.type)}{s.status === "ARRIVED" ? " · arrived" : ""}
                        {next && l.nextStop?.windowEnd && (
                          <T className={cn("num", v.windowMissed && "font-medium text-danger")}> · {v.windowMissed ? "window passed" : "window until"} {clock(l.nextStop.windowEnd, now)}</T>
                        )}
                      </span>
                    </span>
                    {done && <span className="text-[11px]">Done</span>}
                    {next && <Chip tone="accent">Next</Chip>}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <p className="px-3 py-3 text-[12px] text-fg-subtle">
            No active load. {v.inService ? "The truck is in service." : <>Assign one from <Link href="/loads" className="font-medium text-fg hover:text-accent-text">loads</Link>.</>}
          </p>
        )}
      </div>

      <footer className="flex items-center gap-1 border-t border-line px-2 py-1.5">
        <Link href={`/fleet/${t.id}`} className={buttonClass("ghost", "sm")}>Truck <ArrowUpRight /></Link>
        {d && <Link href={`/drivers/${d.id}`} className={buttonClass("ghost", "sm")}>Driver <ArrowUpRight /></Link>}
        {l && <Link href={`/loads/${l.id}`} className={buttonClass("ghost", "sm")}>Load <ArrowUpRight /></Link>}
      </footer>
    </section>
  );
}
