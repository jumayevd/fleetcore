"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, Container, MapPin, Maximize2, OctagonX, Phone, Search, Wrench, X } from "lucide-react";
import { LeafletMap, type MapTruck } from "./map";
import {
  FLEET_STATUSES, FLEET_STATUS_HINT, FLEET_STATUS_LABEL, FLEET_STATUS_TONE, LOW_FUEL_PCT,
  fixAge, fleetStatus, serviceLine, serviceNeeded, serviceTone, sourceLabel, type FleetStatus,
} from "./map/fleet-status";
import { useFormat } from "./locale";
import {
  Avatar, Badge, Chip, EmptyState, IconButton, Kbd, LiveDot, PageHeader, StatusDot,
  buttonClass, cn, inputClass, segmentedThumb, type Tone,
} from "./ui";
import type { FleetSnapshot } from "@/lib/telemetry";
import type { Formatter } from "@/lib/locale";

/** The map only re-renders when its props change, not on every keystroke in the search box. */
const MemoMap = memo(LeafletMap);

const POLL_MS = 10_000;
const CLOCK_MS = 15_000;

type Truck = FleetSnapshot[number];
type Attention = "all" | "oilOverdue" | "oilDue" | "fuel" | "driverHold" | "nodriver";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-muted", accent: "text-accent-text", ok: "text-ok", warn: "text-warn",
  danger: "text-danger", info: "text-info", progress: "text-progress",
};

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
        // Signed in but not allowed to track: keep the snapshot, stop asking.
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

type View = {
  t: Truck;
  status: FleetStatus;
  /** Age of the last position, ms; null when there never was one. */
  fixAgeMs: number | null;
  /** A live tracker fix: speed and engine state are current. */
  live: boolean;
  hasPosition: boolean;
  lowFuel: boolean;
  groupKey: string;
  haystack: string;
};

function derive(t: Truck, now: number): View {
  const s = fleetStatus(t, now);
  return {
    t, ...s,
    lowFuel: t.fuelPct != null && t.fuelPct < LOW_FUEL_PCT,
    groupKey: t.group?.trim() || "none",
    haystack: [
      t.unitNumber, t.plate, t.name, t.group, t.driver?.name, t.place, ...t.trailers.map((r) => r.unitNumber),
      t.workInProgress ? `#${t.workInProgress.number} ${t.workInProgress.title}` : null, t.hold?.label,
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

type Filters = { q: string; status: "all" | FleetStatus; group: string; attention: Attention };

function matches(v: View, f: Filters, skip?: keyof Filters) {
  if (skip !== "q" && f.q && !v.haystack.includes(f.q)) return false;
  if (skip !== "status" && f.status !== "all" && v.status !== f.status) return false;
  if (skip !== "group" && f.group !== "all" && v.groupKey !== f.group) return false;
  if (skip !== "attention" && f.attention !== "all" && !hasAttention(v, f.attention)) return false;
  return true;
}

function hasAttention(v: View, a: Attention) {
  switch (a) {
    case "oilOverdue": return v.t.service.state === "overdue";
    case "oilDue": return v.t.service.state === "due_now" || v.t.service.state === "due_soon";
    case "fuel": return v.lowFuel;
    case "driverHold": return Boolean(v.t.driver?.hold);
    case "nodriver": return !v.t.driver && v.t.status === "ACTIVE";
    default: return true;
  }
}

const toMap = (v: View): MapTruck => ({
  id: v.t.id, unitNumber: v.t.unitNumber, lat: v.t.lat, lng: v.t.lng, heading: v.t.heading, speedKmh: v.t.speedKmh,
  status: v.t.status, driverName: v.t.driver?.name, moving: v.status === "rolling", stale: v.status === "nosignal",
  tone: FLEET_STATUS_TONE[v.status], label: FLEET_STATUS_LABEL[v.status], glyph: v.status === "oos" ? "stop" : "truck",
});

const posOf = (t: Truck | undefined): [number, number] | null => (t && t.lat != null && t.lng != null ? [t.lat, t.lng] : null);
const latestPing = (trucks: FleetSnapshot) => trucks.reduce((m, t) => (t.lastPingAt ? Math.max(m, Date.parse(t.lastPingAt)) : m), 0);

/** Short state for a row: speed when rolling, the hold or the job when off the road, otherwise what the fix says. */
function stateText(v: View, f: Formatter) {
  const { t } = v;
  switch (v.status) {
    case "rolling": return f.speed(t.speedKmh);
    case "idle": return "Idle · engine on";
    case "stopped": return v.live ? "Stopped" : "Parked";
    case "oos": return t.hold ? (t.hold.repaired ? "Out of service · to confirm" : "Out of service · defect") : "Out of service";
    case "shop": return t.workInProgress ? `In shop · #${t.workInProgress.number}` : "In shop";
    case "nosignal": return v.hasPosition ? "No signal" : "No position yet";
  }
}

const placeOf = (v: View) => v.t.place ?? (v.hasPosition ? "Last known position" : "No position");

/* ------------------------------------------------------------------ */
/* Small parts                                                         */
/* ------------------------------------------------------------------ */

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

/** Relative times tick on the client; suppress the warning in case the first client tick lands before hydration ends. */
const T = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span suppressHydrationWarning className={className}>{children}</span>
);

function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 bg-overlay px-3 py-2">
      <p className="eyebrow truncate">{label}</p>
      <p className={cn("num mt-0.5 truncate text-[13px] font-medium", tone ? TONE_TEXT[tone] : "text-fg")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

/** Connection state only (no timestamp), so it can sit in a polite live region without chattering every poll. */
function FeedState({ feed, compact }: { feed: Feed; compact?: boolean }) {
  if (feed === "offline") {
    return <span className="flex items-center gap-1.5 font-medium text-danger"><StatusDot tone="danger" /> {compact ? "Reconnecting" : "Connection lost, retrying"}</span>;
  }
  if (feed === "snapshot") {
    return <span className="flex items-center gap-1.5 text-fg-subtle" title="Positions as of page load"><StatusDot /> Snapshot</span>;
  }
  return <LiveDot />;
}

/** "Out of service" banner: which defect holds it and how it gets released. */
function HoldNote({ t, canEdit, compact }: { t: Truck; canEdit: boolean; compact?: boolean }) {
  if (!t.outOfService) return null;
  const h = t.hold;
  return (
    <div className={cn("flex items-start gap-2 bg-danger-soft text-danger", compact ? "rounded-md px-2 py-1.5" : "border-b border-line px-3 py-2")}>
      <OctagonX aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1 text-[12px] leading-4">
        <p className="font-medium">{h ? (h.repaired ? "Out of service · repaired, waiting to be confirmed" : "Out of service until the repair is verified") : "Marked out of service"}</p>
        {h && <p className="truncate text-[11px] opacity-90" title={h.label}>{h.label}{h.count > 1 ? ` · ${h.count - 1} more` : ""}</p>}
      </div>
      {h && !compact && (
        canEdit && h.repaired
          ? <Link href={`/inspections?review=${t.id}`} className={buttonClass("secondary", "sm")}>Confirm & clear</Link>
          : <Link href={`/inspections/defects?defect=${h.defectId}`} className={buttonClass("secondary", "sm")}>Open defect</Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard mini map                                                  */
/* ------------------------------------------------------------------ */

/** Marker popup on the Today map: who drives it, fuel, odometer, oil service and when it last reported, with the way in. */
function TruckPopup({ v, f }: { v: View; f: Formatter }) {
  const { t } = v;
  const oil = serviceLine(t.service, f);
  // Leaflet colours every link in the map; the spans carry the theme colour instead.
  return (
    <div className="text-[12px] leading-[18px] text-fg">
      <div className="flex items-center gap-1.5">
        <StatusDot tone={FLEET_STATUS_TONE[v.status]} />
        <span className="num text-[13px] font-semibold">{t.unitNumber}</span>
        <span className={cn("ml-auto text-[11px] font-medium", TONE_TEXT[FLEET_STATUS_TONE[v.status]])}>{stateText(v, f)}</span>
      </div>
      <div className="truncate text-[11px] text-fg-subtle">{t.name} · <span className="num">{t.plate}</span></div>
      {t.outOfService && <div className="mt-1.5"><HoldNote t={t} canEdit={false} compact /></div>}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="col-span-2 min-w-0">
          <dt className="text-[11px] text-fg-subtle">Driver</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{t.driver?.name ?? "No driver"}</span>
            {t.driver?.hold && <Chip tone="warn" title={t.driver.holdReason ?? "Driver is on hold"}>Hold</Chip>}
            {t.driver?.phone && (
              <a href={`tel:${t.driver.phone.replace(/\s+/g, "")}`} className="ml-auto shrink-0" title={t.driver.phone}>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted"><Phone className="h-3 w-3" />Call</span>
              </a>
            )}
          </dd>
        </div>
        <div className="min-w-0"><dt className="text-[11px] text-fg-subtle">Fuel</dt><dd><FuelBar pct={t.fuelPct} /></dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-fg-subtle">Odometer</dt><dd className="num truncate">{f.dist(t.odometerKm)}</dd></div>
        <div className="col-span-2 min-w-0">
          <dt className="text-[11px] text-fg-subtle">Oil service</dt>
          <dd className={cn("num truncate", TONE_TEXT[serviceTone(t.service)])}>{oil ?? "No oil change recorded"}</dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-[11px] text-fg-subtle">Last update</dt>
          <dd className="truncate"><T>{fixAge(v.fixAgeMs)}</T> · {sourceLabel(t.pingSource)}</dd>
        </div>
      </dl>
      <div className="mt-2 flex items-center gap-3 border-t border-line pt-2">
        <Link href={`/fleet/${t.id}`}><span className="inline-flex items-center gap-1 font-medium text-fg">Open truck<ArrowUpRight className="h-3 w-3" /></span></Link>
        <Link href={`/tracking?truck=${t.id}`}><span className="text-fg-muted">Live map</span></Link>
      </div>
    </div>
  );
}

/**
 * Compact live map with a status legend, for the Today page. Each legend count opens the live map filtered to it.
 * Pass `live={can(user.role, "tracking.view")}`: without it the map shows the server snapshot and does not poll.
 */
export function LiveFleetMini({ initial, at, height = 360, live = true }: {
  initial: FleetSnapshot;
  /** Server time of `initial` (ISO), the clock during SSR and hydration. */
  at?: string;
  height?: number | string;
  live?: boolean;
}) {
  const f = useFormat();
  const { trucks, feed } = useFleet(initial, live);
  const now = useNow(at ? Date.parse(at) : latestPing(initial));
  const views = useMemo(() => trucks.map((t) => derive(t, now)), [trucks, now]);
  const byId = useMemo(() => new Map(views.map((v) => [v.t.id, v])), [views]);
  const mapTrucks = useMemo(() => views.map(toMap), [views]);
  const renderPopup = useCallback((id: string) => {
    const v = byId.get(id);
    return v ? <TruckPopup v={v} f={f} /> : null;
  }, [byId, f]);
  const count = (s: FleetStatus) => views.filter((v) => v.status === s).length;
  const offMap = views.filter((v) => !v.hasPosition).length;

  return (
    <div>
      <LeafletMap trucks={mapTrucks} height={height} renderPopup={renderPopup} />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-fg-muted">
        {FLEET_STATUSES.map((s) => {
          const n = count(s);
          if (s === "oos" && n === 0) return null;
          const body = (
            <>
              <StatusDot tone={FLEET_STATUS_TONE[s]} className={cn(s === "nosignal" && "opacity-60")} />
              {FLEET_STATUS_LABEL[s]} <span className={cn("num font-medium", n ? (s === "oos" ? "text-danger" : "text-fg") : "text-fg-faint")}>{n}</span>
            </>
          );
          return live
            ? <Link key={s} href={`/tracking?status=${s}`} title={FLEET_STATUS_HINT[s]} className="inline-flex items-center gap-1.5 rounded hover:text-fg">{body}</Link>
            : <span key={s} title={FLEET_STATUS_HINT[s]} className="inline-flex items-center gap-1.5">{body}</span>;
        })}
        <span className="ml-auto flex items-center gap-2">
          {offMap > 0 && <span className="text-fg-subtle" title="Trucks with no position yet are listed on the live map, not drawn on it">{offMap} not on the map</span>}
          <FeedState feed={feed} compact />
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live map page                                                       */
/* ------------------------------------------------------------------ */

const ATTENTION_ITEMS: { key: Exclude<Attention, "all">; label: string; tone: Tone }[] = [
  { key: "oilOverdue", label: "Oil overdue", tone: "danger" },
  { key: "oilDue", label: "Oil due", tone: "warn" },
  { key: "fuel", label: "Low fuel", tone: "warn" },
  { key: "driverHold", label: "Driver on hold", tone: "warn" },
  { key: "nodriver", label: "No driver", tone: "neutral" },
];

/** Full live map: filterable list, map, detail panel for the selected truck. */
export function TrackingBoard({ initial, at, selectedId: initialSelected, initialStatus = "all", initialGroup = "all", canEdit = false }: {
  initial: FleetSnapshot;
  /** Server time of `initial` (ISO). Used as the clock during SSR so nothing mismatches on hydration. */
  at?: string;
  /** Pre-selected truck id (deep link `/tracking?truck=…`). */
  selectedId?: string | null;
  /** Status filter from `?status=` (rolling, idle, stopped, shop, oos, nosignal). */
  initialStatus?: "all" | FleetStatus;
  /** Group filter from `?group=` ("none" = trucks without a group). */
  initialGroup?: string;
  /** Show edit actions (book oil service, assign a driver, confirm a repair). */
  canEdit?: boolean;
}) {
  const f = useFormat();
  const { trucks, updatedAt, feed } = useFleet(initial);
  const mounted = useMounted();
  const now = useNow(at ? Date.parse(at) : latestPing(initial));
  const linked = initialSelected ?? null;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | FleetStatus>(initialStatus);
  const [group, setGroup] = useState(initialGroup);
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
  const filters: Filters = useMemo(() => ({ q: q.trim().toLowerCase(), status, group, attention }), [q, status, group, attention]);
  const list = useMemo(() => views.filter((v) => matches(v, filters)), [views, filters]);
  const count = (skip: keyof Filters, pred: (v: View) => boolean) => views.filter((v) => matches(v, filters, skip) && pred(v)).length;

  const groups = useMemo(() => {
    const names = new Set<string>();
    let none = false;
    for (const v of views) { if (v.groupKey === "none") none = true; else names.add(v.groupKey); }
    return { names: [...names].sort(), none };
  }, [views]);

  const selected = useMemo(() => views.find((v) => v.t.id === selectedId) ?? null, [views, selectedId]);
  const filtersActive = filters.q !== "" || status !== "all" || group !== "all" || attention !== "all";

  const select = useCallback((id: string | null, fly = true) => {
    setSelectedId(id);
    const p = fly && id ? posOf(trucks.find((t) => t.id === id)) : null;
    if (p) setFlyTo(p);
  }, [trucks]);
  const onMapSelect = useCallback((id: string) => select(id, false), [select]);
  const clearFilters = () => { setQ(""); setStatus("all"); setGroup("all"); setAttention("all"); };

  // The URL follows the selection and the filters, so a view can be bookmarked or shared.
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string | null) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set("truck", selectedId);
    set("status", status === "all" ? null : status);
    set("group", group === "all" ? null : group);
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [selectedId, status, group]);

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
  const totals = useMemo(() => {
    const out = { rolling: 0, idle: 0, stopped: 0, shop: 0, oos: 0, nosignal: 0 } as Record<FleetStatus, number>;
    for (const v of views) out[v.status]++;
    return out;
  }, [views]);
  const offMap = views.filter((v) => !v.hasPosition).length;
  const shownAt = updatedAt ?? (at ? Date.parse(at) : null);
  const summary = [
    `${views.length} truck${views.length === 1 ? "" : "s"}`,
    ...FLEET_STATUSES.filter((s) => totals[s] > 0).map((s) => `${totals[s]} ${FLEET_STATUS_LABEL[s].toLowerCase()}`),
  ].join(" · ");

  return (
    <div className="flex flex-col xl:h-[calc(100vh-84px)] xl:min-h-[560px]">
      <PageHeader
        title="Live map"
        subtitle={<span className="num">{summary}</span>}
        actions={
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[12px]">
            {/* Only the connection state is announced; the timestamp changes every poll and stays out of the live region. */}
            <span role="status" aria-live="polite"><FeedState feed={feed} /></span>
            <span className="text-fg-faint" aria-hidden="true">·</span>
            <span className="num text-fg-muted" title={`Company time (${f.zone(shownAt ?? undefined)})`}>
              {mounted && shownAt ? <>Updated <T>{f.time(shownAt)}</T></> : `Every ${POLL_MS / 1000} s`}
            </span>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[372px_minmax(0,1fr)]">
        {/* ---------------- List ---------------- */}
        <aside className="isolate flex min-h-0 flex-col rounded-lg border border-line bg-surface" aria-label="Fleet list">
          <div className="space-y-2 border-b border-line p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-faint" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Unit, plate, driver, trailer, place"
                aria-label="Search fleet" className={cn(inputClass, "pl-8 pr-8")} />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1.5 top-1.5 rounded p-0.5 text-fg-subtle hover:bg-raised hover:text-fg"><X className="h-4 w-4" /></button>
              )}
            </div>
            <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-0.5 rounded-[10px] bg-sunken p-[3px]">
              {(["all", ...FLEET_STATUSES] as const).map((s) => {
                const on = status === s;
                const n = s === "all" ? undefined : count("status", (v) => v.status === s);
                // Out of service only earns a button when something is out of service (or it is the active filter).
                if (s === "oos" && !n && !on) return null;
                return (
                  <button key={s} type="button" aria-pressed={on} onClick={() => setStatus(s)} title={s === "all" ? undefined : FLEET_STATUS_HINT[s]}
                    className={cn(segmentedThumb(on), "h-6 px-2")}>
                    {s !== "all" && <StatusDot tone={FLEET_STATUS_TONE[s]} className={cn(s === "nosignal" && "opacity-60")} />}
                    {s === "all" ? "All" : FLEET_STATUS_LABEL[s]}
                    {n != null && <span className={cn("num text-[10.5px]", on ? "text-fg-subtle" : s === "oos" ? "text-danger" : "text-fg-faint")}>{n}</span>}
                  </button>
                );
              })}
            </div>
            {(groups.names.length > 0) && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group"
                className={cn(inputClass, "h-7 w-auto min-w-0 py-0 pr-7 text-[12px]", group !== "all" && "border-line-strong text-fg")}>
                <option value="all">All groups</option>
                {groups.names.map((n) => <option key={n} value={n}>{n}</option>)}
                {groups.none && <option value="none">No group</option>}
              </select>
            )}
            <AttentionRow value={attention} onChange={setAttention} count={(k) => count("attention", (v) => hasAttention(v, k))} />
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain max-xl:max-h-[46vh]" aria-label="Trucks" data-fleet-list>
            {list.map((v) => (
              <TruckCard key={v.t.id} v={v} f={f} selected={v.t.id === selectedId} onSelect={() => select(v.t.id)} />
            ))}
            {list.length === 0 && (
              <li>
                <EmptyState title={filtersActive ? "No trucks match" : "No trucks in service yet"}
                  description={filtersActive
                    ? "Clear the search or filters to see the whole fleet."
                    : "Add trucks in Fleet. Each one appears here with its last known position, from a manual update or a connected tracker."}
                  action={filtersActive
                    ? <button type="button" onClick={clearFilters} className={buttonClass("secondary", "sm")}>Clear filters</button>
                    : <Link href={canEdit ? "/fleet/new" : "/fleet"} className={buttonClass("secondary", "sm")}>{canEdit ? "Add a truck" : "Open fleet"}</Link>} />
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
            <MemoMap trucks={mapTrucks} selectedId={selectedId} onSelect={onMapSelect}
              height="100%" fitKey={`all-${fitN}`} flyTo={flyTo} className="rounded-none" />
          </div>

          <div className="absolute left-3 top-[88px] z-[1001]">
            <IconButton label="Fit all trucks" onClick={() => { setFitN((n) => n + 1); setFlyTo(null); }}
              className="border border-line bg-overlay shadow-float hover:bg-raised"><Maximize2 /></IconButton>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 z-[1001] hidden flex-wrap items-center gap-3 rounded-md border border-line bg-overlay/90 px-2.5 py-1.5 text-[11px] text-fg-muted shadow-float backdrop-blur md:flex">
            {FLEET_STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                {s === "oos"
                  ? <OctagonX aria-hidden className="h-3 w-3 text-danger" />
                  : <StatusDot tone={FLEET_STATUS_TONE[s]} className={cn(s === "nosignal" && "opacity-60")} />} {FLEET_STATUS_LABEL[s]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="accent" /> Selected</span>
            {offMap > 0 && <span className="text-fg-subtle">{offMap} without a position (in the list only)</span>}
          </div>

          {selected && <DetailPanel v={selected} f={f} canEdit={canEdit} onClose={() => select(null)} />}
        </div>
      </div>
    </div>
  );
}

function AttentionRow({ value, onChange, count }: { value: Attention; onChange: (a: Attention) => void; count: (k: Exclude<Attention, "all">) => number }) {
  const items = ATTENTION_ITEMS.map((i) => ({ ...i, n: count(i.key) })).filter((i) => i.n > 0 || i.key === value);
  if (items.length === 0) return <p className="px-0.5 text-[11px] text-fg-subtle">No oil due, low fuel, holds or unassigned trucks right now</p>;
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

function TruckCard({ v, f, selected, onSelect }: { v: View; f: Formatter; selected: boolean; onSelect: () => void }) {
  const { t } = v;
  const tone = FLEET_STATUS_TONE[v.status];
  const oil = serviceNeeded(t.service) ? serviceLine(t.service, f) : null;

  return (
    <li id={`truck-${t.id}`}>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className={cn("block w-full border-l-2 px-3 py-2 text-left transition-colors hover:bg-raised focus-visible:outline-none focus-visible:bg-raised",
          selected ? "border-accent bg-accent-soft/50 hover:bg-accent-soft/50" : v.status === "oos" ? "border-danger" : "border-transparent")}>
        {/* Unit · plate · state */}
        <div className="flex items-center gap-2">
          {v.status === "oos"
            ? <OctagonX aria-hidden className="h-3.5 w-3.5 shrink-0 text-danger" />
            : <StatusDot tone={tone} pulse={v.status === "rolling"} className={cn(v.status === "nosignal" && "opacity-60")} />}
          <span className="num text-[13px] font-semibold text-fg">{t.unitNumber}</span>
          <span className="num truncate text-[11px] text-fg-subtle">{t.plate}</span>
          <span className="ml-auto shrink-0">
            {v.status === "oos"
              ? <Badge value="OUT_OF_SERVICE" tone="danger" label={stateText(v, f)} />
              : v.status === "shop"
                ? <Badge value="MAINTENANCE" label={stateText(v, f)} />
                : v.status === "rolling"
                  ? <span className="num text-[12px] font-medium text-fg">{f.number(t.speedKmh)} <span className="text-[10px] font-normal text-fg-subtle">{f.labels.speed}</span></span>
                  : <span className={cn("text-[11px]", v.status === "nosignal" ? "font-medium text-danger" : "text-fg-subtle")}>{stateText(v, f)}</span>}
          </span>
        </div>

        {/* Driver · hold · trailers */}
        <div className="mt-1 flex items-center gap-1.5">
          <span className={cn("truncate text-[12px]", t.driver ? "text-fg-muted" : "text-fg-faint")}>{t.driver?.name ?? "No driver"}</span>
          {t.driver?.hold && <Chip tone="warn" title={t.driver.holdReason ?? "Driver is on hold"}>Hold</Chip>}
          {t.trailers.length > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle" title="Paired trailer">
              <Container className="h-3 w-3" /><span className="num">{t.trailers.map((r) => r.unitNumber).join(", ")}</span>
            </span>
          )}
        </div>

        {/* Location · fuel · last update */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{placeOf(v)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <FuelBar pct={t.fuelPct} />
            <T className="num">{fixAge(v.fixAgeMs)}</T>
          </span>
        </div>

        {(oil || t.hold) && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            {t.hold && <span className="truncate text-[11px] text-danger" title={t.hold.label}>{t.hold.label}</span>}
            {oil && <Chip tone={serviceTone(t.service)} className="shrink-0">{oil}</Chip>}
          </div>
        )}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Detail panel                                                        */
/* ------------------------------------------------------------------ */

function DetailPanel({ v, f, canEdit, onClose }: { v: View; f: Formatter; canEdit: boolean; onClose: () => void }) {
  const { t } = v;
  const d = t.driver;
  const job = t.workInProgress;
  const oil = serviceLine(t.service, f);
  const oilTone = serviceTone(t.service);
  const statusLabel = v.status === "oos" ? "Out of service" : FLEET_STATUS_LABEL[v.status];

  return (
    <section aria-label={`Truck ${t.unitNumber}`}
      className="absolute inset-x-2 bottom-2 z-[1002] flex max-h-[calc(100%-16px)] flex-col overflow-hidden rounded-lg border border-line bg-overlay/95 shadow-float backdrop-blur sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:w-[352px] sm:max-h-[calc(100%-24px)]">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2">
        <StatusDot tone={FLEET_STATUS_TONE[v.status]} pulse={v.status === "rolling"} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/fleet/${t.id}`} className="num text-[15px] font-semibold leading-5 text-fg hover:text-accent-text">{t.unitNumber}</Link>
            <Badge value={v.status.toUpperCase()} tone={FLEET_STATUS_TONE[v.status]} label={statusLabel} />
          </div>
          <p className="truncate text-[11px] text-fg-subtle">
            {t.name} {t.year} · <span className="num">{t.plate}</span>{t.group ? ` · ${t.group}` : ""}
          </p>
        </div>
        <IconButton label="Close panel" onClick={onClose}><X /></IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <HoldNote t={t} canEdit={canEdit} />

        <div className="grid grid-cols-2 gap-px border-b border-line bg-line">
          <Metric label={v.live ? "Speed" : "Last known speed"} value={<>{f.number(t.speedKmh)} <span className="text-[11px] font-normal text-fg-subtle">{f.labels.speed}</span></>}
            hint={v.live ? (t.engineOn ? "Engine on" : "Engine off") : "No live data"} />
          <Metric label="Fuel" value={<FuelBar pct={t.fuelPct} wide />} hint={v.lowFuel ? `Below ${LOW_FUEL_PCT}%, plan a fuel stop` : undefined} tone={v.lowFuel ? "warn" : undefined} />
          <Metric label="Odometer" value={f.dist(t.odometerKm)} hint={t.odometerAt ? `as of ${f.day(t.odometerAt)}` : "No reading date"} />
          <Metric label="Oil service" value={oil ? oil.replace(/^Oil:? /, "") : "Not recorded"} tone={oilTone === "neutral" || oilTone === "ok" ? undefined : oilTone}
            hint={t.service.dueAtKm != null ? `due at ${f.dist(t.service.dueAtKm)}` : "Log an oil change to start the count"} />
          <Metric label="Location" value={<span className="font-sans">{placeOf(v)}</span>}
            hint={t.lat != null && t.lng != null ? `${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}` : undefined} />
          <Metric label="Last update" value={<T>{fixAge(v.fixAgeMs)}</T>} tone={v.status === "nosignal" ? "danger" : undefined} hint={sourceLabel(t.pingSource)} />
        </div>

        {/* Driver */}
        <div className="flex items-center gap-2.5 border-b border-line px-3 py-2">
          {d ? (
            <>
              <Avatar name={d.name} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link href={`/drivers/${d.id}`} className="truncate text-[13px] font-medium text-fg hover:text-accent-text">{d.name}</Link>
                  {d.hold && <Chip tone="warn">Hold</Chip>}
                </div>
                <p className="truncate text-[11px] text-fg-subtle">{d.hold ? (d.holdReason ?? "On hold, no reason recorded") : d.phone ?? "No phone on file"}</p>
              </div>
              {d.phone && (
                <a href={`tel:${d.phone.replace(/\s+/g, "")}`} className={buttonClass("secondary", "sm")} title={d.phone}>
                  <Phone /> Call
                </a>
              )}
            </>
          ) : (
            <p className="text-[12px] text-fg-subtle">
              No driver assigned.{" "}
              {canEdit && <Link href={`/fleet/${t.id}/edit`} className="font-medium text-fg hover:text-accent-text">Assign one</Link>}
            </p>
          )}
        </div>

        {/* Trailers and shop */}
        <dl className="space-y-2 px-3 py-2.5 text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-fg-subtle">Trailer</dt>
            <dd className="flex min-w-0 flex-wrap justify-end gap-x-2">
              {t.trailers.length
                ? t.trailers.map((r) => <Link key={r.id} href={`/fleet/trailers/${r.id}`} className="num font-medium text-fg hover:text-accent-text">{r.unitNumber}</Link>)
                : <span className="text-fg-faint">None paired</span>}
            </dd>
          </div>
          {job && (
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-fg-subtle"><Wrench className="h-3.5 w-3.5" />In the shop for</dt>
              <dd className="min-w-0 truncate">
                <Link href={`/maintenance/work-orders/${job.id}`} className="font-medium text-fg hover:text-accent-text">
                  <span className="num text-fg-subtle">#{job.number}</span> {job.title}
                </Link>
              </dd>
            </div>
          )}
        </dl>

        {serviceNeeded(t.service) && canEdit && !job && (
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
            <span className={cn("num text-[12px] font-medium", TONE_TEXT[oilTone])}>{oil}</span>
            <Link href={`/maintenance/oil?book=${t.id}`} className={buttonClass("secondary", "sm")}>Book oil service</Link>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-1 border-t border-line px-2 py-1.5">
        <Link href={`/fleet/${t.id}`} className={buttonClass("ghost", "sm")}>Truck <ArrowUpRight /></Link>
        {d && <Link href={`/drivers/${d.id}`} className={buttonClass("ghost", "sm")}>Driver <ArrowUpRight /></Link>}
        {job && <Link href={`/maintenance/work-orders/${job.id}`} className={buttonClass("ghost", "sm")}>Repair <ArrowUpRight /></Link>}
      </footer>
    </section>
  );
}
