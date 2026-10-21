"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from "react";
import {
  Bed, ChevronDown, ChevronRight, CircleCheck, ClockFading, Copy, Ellipsis, Eraser, House, Keyboard, OctagonPause, Package, Phone, Search, TreePalm, Undo2, Users, X,
} from "lucide-react";
import { Badge, Button, Chip, cn, EmptyState, IconButton, Kbd, LiveDot, Progress, STATUS_TONE, StatusDot, TONE_DOT, inputClass, segmentedThumb, segmentedTrack, type Tone } from "@/components/ui";
import { BOARD_STATUS_LABELS, BOARD_STATUS_ORDER, DRIVER_TYPE_LABELS, DRIVER_TYPE_SHORT, EQUIPMENT_LABELS, MANUAL_BOARD_STATUSES, type BoardStatus } from "@/lib/constants";
import { ago, number } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { restoreAutoStatus, setBoardNote, setBoardStatus, setRowColor } from "@/app/actions/board";
import { Drawer, Menu, MenuDivider, MenuItem, MenuLabel } from "./overlays";
import { fmtDateTime, fmtDayMonth, fmtHm, fmtHms, ymdOf } from "./dates";
import {
  duration, durationUntil, hoursBetween, rowHaystack, ROW_COLORS, ROW_COLOR_BG, ROW_COLOR_LABEL,
  type BoardPayload, type BoardRow, type RowColor, type StatusEvent,
} from "./types";

const POLL_MS = 15_000;
const STICKY_LOAD = 132;
const STICKY_DRIVER = 212;

/* ------------------------------------------------------------------ */
/* Clock — one shared 30 s ticker; server snapshot 0 avoids hydration drift */
/* ------------------------------------------------------------------ */

const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
function subscribeTick(cb: () => void) {
  tickListeners.add(cb);
  if (!tickTimer) tickTimer = setInterval(() => tickListeners.forEach((l) => l()), 30_000);
  return () => { tickListeners.delete(cb); if (!tickListeners.size && tickTimer) { clearInterval(tickTimer); tickTimer = null; } };
}
const useNow = () => useSyncExternalStore(subscribeTick, () => Math.floor(Date.now() / 30_000) * 30_000, () => 0);

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

type ColKey = "load" | "driver" | "truck" | "trailer" | "phone" | "status" | "since" | "eta" | "km" | "next" | "notes";
type Column = { key: ColKey; label: string; copy: (r: BoardRow, now: number) => string };

// All clock times are company time (dates.ts), so the server render and hydration produce the same text.
const hhmm = fmtHm;
const remainingKm = (l: NonNullable<BoardRow["load"]>) => (l.status === "IN_TRANSIT" ? Math.max(0, Math.round(l.distanceKm * (1 - l.progress))) : Math.round(l.distanceKm));

const COLUMNS: Column[] = [
  { key: "load", label: "Load", copy: (r) => r.load?.reference ?? "" },
  { key: "driver", label: "Driver", copy: (r) => r.driver.name },
  { key: "truck", label: "Truck", copy: (r) => r.truck?.unitNumber ?? "" },
  { key: "trailer", label: "Trailer", copy: (r) => r.trailer?.unitNumber ?? "" },
  { key: "phone", label: "Phone", copy: (r) => [r.driver.phone, r.driver.phone2].filter(Boolean).join(" / ") },
  { key: "status", label: "Status", copy: (r) => BOARD_STATUS_LABELS[r.status as BoardStatus] ?? r.status },
  { key: "since", label: "Active since", copy: (r, now) => (now ? duration(r.statusSince, now) : "") },
  { key: "eta", label: "ETA / next", copy: (r) => (r.load?.status === "IN_TRANSIT" ? `ETA ${hhmm(r.load.eta)}` : r.load ? `Pickup ${fmtDateTime(r.load.pickupAt)}` : "") },
  { key: "km", label: "Km", copy: (r) => (r.load ? String(remainingKm(r.load)) : "") },
  { key: "next", label: "Next stop", copy: (r) => (r.load?.nextStop ? `${r.load.nextStop.name}, ${r.load.nextStop.city}` : "") },
  { key: "notes", label: "Notes", copy: (r) => r.cell.note ?? "" },
];

const STATUS_ICON: Record<string, ReactNode> = {
  STOP: <OctagonPause />, REST: <Bed />, HOME: <House />, VACATION: <TreePalm />, READY: <CircleCheck />,
};
const SWATCH: Record<RowColor, string> = { amber: "bg-accent", green: "bg-ok", red: "bg-danger", blue: "bg-info", violet: "bg-progress" };

type Filter = { kind: "status" | "flag"; value: string } | null;
type Group = { key: string; name: string; color: string | null; rows: BoardRow[] };

const statusRank = (s: string) => { const i = BOARD_STATUS_ORDER.indexOf(s as BoardStatus); return i === -1 ? 99 : i; };
const flagOf = (r: BoardRow, flag: string) =>
  flag === "late" ? Boolean(r.load?.late || r.load?.latePickup) : flag === "norc" ? Boolean(r.load && !r.load.hasRc) : flag === "hold" ? r.driver.hold : flag === "manual" ? r.statusManual : false;

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export function DispatchBoard({ initial, view, canEdit, team, initialQ, focusDriverId, teamFilter }: {
  initial: BoardPayload; view: "teams" | "flat"; canEdit: boolean; team: string | null; initialQ: string; focusDriverId: string | null;
  /** The page's team switcher (links), shown at the start of the toolbar. */
  teamFilter?: ReactNode;
}) {
  const router = useRouter();
  const now = useNow();
  const [data, setData] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [q, setQ] = useState(initialQ);
  const [filter, setFilter] = useState<Filter>(null);
  const [focusId, setFocusId] = useState<string | null>(focusDriverId);
  const [selectedCol, setSelectedCol] = useState<ColKey | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteState, setNoteState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [flash, setFlash] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [, startTransition] = useTransition();
  const gridRef = useRef<HTMLDivElement>(null);
  const live = data.today;

  // Keep the URL shareable without re-rendering the server page.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, [q]);

  const refresh = useCallback(async () => {
    try {
      const p = new URLSearchParams({ date: initial.date });
      if (team) p.set("team", team);
      const r = await fetch(`/api/board?${p}`, { cache: "no-store" });
      if (r.ok) { setData(await r.json()); setUpdatedAt(new Date().toISOString()); }
    } catch { /* offline — keep the last snapshot */ }
  }, [initial.date, team]);

  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);

  const run = useCallback((fn: () => Promise<ActionState>, opts: { quiet?: boolean } = {}) => {
    startTransition(async () => {
      try {
        const res = await fn();
        if (res?.error) setFlash({ tone: "error", text: res.error });
        else if (res?.ok && !opts.quiet) setFlash({ tone: "ok", text: res.ok });
      } catch {
        setFlash({ tone: "error", text: "Could not save. Check your connection and try again." });
      }
      await refresh();
    });
  }, [refresh]);

  /* ---------- derived rows ---------- */
  const term = q.trim().toLowerCase();
  const visible = useMemo(() => data.rows.filter((r) => {
    if (term && !rowHaystack(r).includes(term)) return false;
    if (filter?.kind === "status" && r.status !== filter.value) return false;
    if (filter?.kind === "flag" && !flagOf(r, filter.value)) return false;
    return true;
  }), [data.rows, term, filter]);

  const groups = useMemo<Group[]>(() => {
    if (view === "flat") {
      const rows = [...visible].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.driver.name.localeCompare(b.driver.name));
      return [{ key: "all", name: "All drivers", color: null, rows }];
    }
    const map = new Map<string, Group>();
    for (const r of visible) {
      const key = r.team?.id ?? "none";
      if (!map.has(key)) map.set(key, { key, name: r.team?.name ?? "No team", color: r.team?.color ?? null, rows: [] });
      map.get(key)!.rows.push(r);
    }
    const out = [...map.values()];
    const none = out.findIndex((g) => g.key === "none");
    if (none !== -1) out.push(...out.splice(none, 1));
    return out;
  }, [visible, view]);

  const ordered = useMemo(() => groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows)), [groups, collapsed]);
  const focusIdx = ordered.findIndex((r) => r.driver.id === focusId);
  const focused = focusIdx === -1 ? null : ordered[focusIdx];
  const rowById = useCallback((id: string | null) => data.rows.find((r) => r.driver.id === id) ?? null, [data.rows]);

  const summary = useMemo(() => {
    const statuses = new Map<string, number>();
    for (const r of data.rows) statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
    const flags = (["late", "norc", "hold", "manual"] as const).map((f) => [f, data.rows.filter((r) => flagOf(r, f)).length] as const).filter(([, n]) => n);
    return { statuses: [...statuses].sort((a, b) => statusRank(a[0]) - statusRank(b[0])), flags };
  }, [data.rows]);

  /* ---------- focus & keyboard ---------- */
  const scrollRowIntoView = (id: string) => gridRef.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.scrollIntoView({ block: "nearest" });
  const moveFocus = (delta: number) => {
    if (!ordered.length) return;
    const next = focusIdx === -1 ? (delta > 0 ? 0 : ordered.length - 1) : Math.min(ordered.length - 1, Math.max(0, focusIdx + delta));
    const id = ordered[next].driver.id;
    setFocusId(id);
    scrollRowIntoView(id);
  };
  const openRow = (r: BoardRow | null) => { if (r) router.push(r.load ? `/loads/${r.load.id}` : `/drivers/${r.driver.id}`); };
  const cycleColor = (r: BoardRow | null) => {
    if (!r || !canEdit) return;
    const i = r.cell.color ? ROW_COLORS.indexOf(r.cell.color) : -1;
    const next = i === ROW_COLORS.length - 1 ? null : ROW_COLORS[i + 1];
    run(() => setRowColor(data.date, r.driver.id, next), { quiet: true });
  };
  const focusNotes = (r: BoardRow | null) => { if (r) gridRef.current?.querySelector<HTMLInputElement>(`[data-note="${r.driver.id}"]`)?.focus(); };
  const copyColumn = useCallback(async (key: ColKey) => {
    const col = COLUMNS.find((c) => c.key === key)!;
    const text = [col.label, ...ordered.map((r) => col.copy(r, now))].join("\t");
    try { await navigator.clipboard.writeText(text); setFlash({ tone: "ok", text: `Copied ${ordered.length} ${col.label.toLowerCase()} values` }); }
    catch { setFlash({ tone: "error", text: "Clipboard is not available in this browser" }); }
  }, [ordered, now]);

  const onGridKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedCol && !typing && !window.getSelection()?.toString()) {
      e.preventDefault(); void copyColumn(selectedCol); return;
    }
    if (typing) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Enter / Space on a focused link or button (load, driver, row actions, team toggle, column header) is that control's own
    // activation; the grid shortcuts only apply when the grid itself or a plain cell has focus. Arrows and Esc still work.
    const onControl = t !== e.currentTarget && t.closest("a, button, [role=menuitem]") !== null;
    if (onControl && e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveFocus(1); break;
      case "ArrowUp": e.preventDefault(); moveFocus(-1); break;
      case "Enter": e.preventDefault(); openRow(focused); break;
      case "c": e.preventDefault(); cycleColor(focused); break;
      case "n": e.preventDefault(); focusNotes(focused); break;
      case "h": e.preventDefault(); if (focused) setDrawerId(focused.driver.id); break;
      case "Escape": setSelectedCol(null); break;
    }
  };

  useEffect(() => {
    if (focusDriverId) setTimeout(() => scrollRowIntoView(focusDriverId), 50);
  }, [focusDriverId]);

  /* ---------- notes ---------- */
  const saveNote = (r: BoardRow, value: string) => {
    const current = r.cell.note ?? "";
    if (value.trim() === current.trim()) { setDrafts((d) => { const n = { ...d }; delete n[r.driver.id]; return n; }); return; }
    setNoteState((s) => ({ ...s, [r.driver.id]: "saving" }));
    startTransition(async () => {
      let failed = false;
      try {
        const res = await setBoardNote(data.date, r.driver.id, value);
        if (res?.error) { failed = true; setFlash({ tone: "error", text: res.error }); }
      } catch {
        failed = true;
        setFlash({ tone: "error", text: "Could not save the note. Check your connection and try again." });
      }
      setNoteState((s) => ({ ...s, [r.driver.id]: failed ? "error" : "saved" }));
      await refresh();
      // On failure the typed text stays in the cell so it can be saved again.
      if (!failed) setDrafts((d) => { const n = { ...d }; delete n[r.driver.id]; return n; });
      setTimeout(() => setNoteState((s) => { const n = { ...s }; delete n[r.driver.id]; return n; }), failed ? 4000 : 1500);
    });
  };

  const menuRow = rowById(menu?.id ?? null);
  const drawerRow = rowById(drawerId);
  const endOfDay = useMemo(() => Date.parse(data.dayEnd) - 1, [data.dayEnd]);
  const clock = data.today ? now : Math.min(now, endOfDay);

  return (
    <div className="space-y-3">
      {/* Toolbar: team and search on one line, the day's statuses on the next. */}
      <div className="flex flex-wrap items-center gap-2">
        {teamFilter}
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the board…" title="Driver, truck, load or city" aria-label="Filter board"
            className={cn(inputClass, "w-60 pl-8 pr-7")} />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:bg-raised hover:text-fg"><X className="h-3.5 w-3.5" /></button>}
        </label>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-fg-subtle">
          {selectedCol && (
            <button type="button" onClick={() => void copyColumn(selectedCol)} className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent-text hover:border-accent">
              <Copy className="h-3 w-3" /> Copy {COLUMNS.find((c) => c.key === selectedCol)?.label.toLowerCase()}
            </button>
          )}
          <span className="num">{visible.length} of {data.rows.length} drivers</span>
          {live ? <LiveDot label={updatedAt ? `Live · ${fmtHms(updatedAt)}` : "Live"} /> : <span>{data.rows[0]?.statusMode === "history" ? "Status as of end of day" : "Planned · statuses are today's"}</span>}
          {/* Shortcuts live behind one quiet icon instead of a permanent line of hints. */}
          <details className="relative hidden xl:block">
            <summary title="Keyboard shortcuts" aria-label="Keyboard shortcuts"
              className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-raised hover:text-fg [&::-webkit-details-marker]:hidden">
              <Keyboard className="h-4 w-4" />
            </summary>
            <ul className="pop-in absolute right-0 top-9 z-30 w-72 space-y-2 rounded-lg border border-line bg-overlay p-3 text-[12px] text-fg-muted shadow-float">
              <li className="flex items-center justify-between gap-3">Move between drivers <span className="flex gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span></li>
              <li className="flex items-center justify-between gap-3">Open driver details <Kbd>↵</Kbd></li>
              {canEdit && <li className="flex items-center justify-between gap-3">Row colour <Kbd>c</Kbd></li>}
              {canEdit && <li className="flex items-center justify-between gap-3">Notes <Kbd>n</Kbd></li>}
              <li className="flex items-center justify-between gap-3">Status history <Kbd>h</Kbd></li>
              <li className="flex items-center justify-between gap-3">Copy a column (click its header) <span className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>C</Kbd></span></li>
            </ul>
          </details>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className={segmentedTrack} role="group" aria-label="Filter by status">
          <SummaryPill active={!filter} onClick={() => setFilter(null)} label="All" count={data.rows.length} />
          {summary.statuses.map(([s, n]) => (
            <SummaryPill key={s} tone={STATUS_TONE[s] ?? "neutral"} label={BOARD_STATUS_LABELS[s as BoardStatus] ?? s} count={n}
              active={filter?.kind === "status" && filter.value === s} onClick={() => setFilter(filter?.kind === "status" && filter.value === s ? null : { kind: "status", value: s })} />
          ))}
        </div>
        {summary.flags.length > 0 && (
          <div className={segmentedTrack} role="group" aria-label="Filter by flag">
            {summary.flags.map(([f, n]) => (
              <SummaryPill key={f} tone={f === "late" ? "danger" : f === "norc" || f === "hold" ? "warn" : "accent"} count={n}
                label={f === "late" ? "Running late" : f === "norc" ? "No RC" : f === "hold" ? "On hold" : "Manual status"}
                active={filter?.kind === "flag" && filter.value === f} onClick={() => setFilter(filter?.kind === "flag" && filter.value === f ? null : { kind: "flag", value: f })} />
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div ref={gridRef} tabIndex={0} onKeyDown={onGridKey} aria-label="Dispatch board"
        className="relative max-h-[calc(100vh-252px)] min-h-[240px] overflow-auto rounded-lg border border-line bg-surface shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-20">
            <tr className="text-left text-[12px] font-medium text-fg-subtle">
              {COLUMNS.map((c, i) => {
                const sticky = i === 0 ? { left: 0, width: STICKY_LOAD } : i === 1 ? { left: STICKY_LOAD, width: STICKY_DRIVER } : null;
                const active = selectedCol === c.key;
                return (
                  <th key={c.key} scope="col" style={sticky ? { left: sticky.left, width: sticky.width, minWidth: sticky.width, maxWidth: sticky.width } : undefined}
                    className={cn("h-9 whitespace-nowrap border-b border-line bg-raised px-3 font-medium", sticky && "sticky z-30", i === 1 && "border-r border-line")}>
                    <button type="button" onClick={() => setSelectedCol(active ? null : c.key)} aria-pressed={active} title={active ? "Click to deselect" : "Select column (Ctrl+C copies it)"}
                      className={cn("-mx-1.5 inline-flex h-6 items-center gap-1 rounded px-1.5 transition-colors hover:text-fg", active && "bg-accent-soft text-accent-text")}>
                      {c.label}<span className="sr-only">, select column for copying</span>{active && <Copy className="h-3 w-3" />}
                    </button>
                  </th>
                );
              })}
              <th className="h-9 w-10 border-b border-line bg-raised" />
            </tr>
          </thead>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            const counts = BOARD_STATUS_ORDER.map((s) => [s, g.rows.filter((r) => r.status === s).length] as const).filter(([, n]) => n);
            return (
              <tbody key={g.key}>
                {view === "teams" && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="border-b border-line bg-raised p-0">
                      <button type="button" onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                        className="sticky left-0 flex h-8 max-w-[calc(100vw-120px)] items-center gap-2 px-3 text-left text-[12px] text-fg hover:text-accent-text">
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" /> : <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" />}
                        <span className="h-2 w-2 rounded-full ring-1 ring-line" style={{ background: g.color ?? "var(--fg-faint)" }} />
                        <span className="font-semibold">{g.name}</span>
                        <span className="num text-fg-subtle">{g.rows.length}</span>
                        <span className="hidden items-center gap-1 sm:flex">
                          {counts.map(([s, n]) => (
                            <span key={s} title={`${n} ${BOARD_STATUS_LABELS[s].toLowerCase()}`} className="num inline-flex items-center gap-1 rounded-full bg-surface px-1.5 text-[11px] leading-[18px] text-fg-muted ring-1 ring-line">
                              <StatusDot tone={STATUS_TONE[s] ?? "neutral"} />{n}
                            </span>
                          ))}
                        </span>
                      </button>
                    </td>
                  </tr>
                )}
                {!isCollapsed && g.rows.map((r) => (
                  <Row key={r.driver.id} r={r} date={data.date} now={clock} liveClock={now > 0} canEdit={canEdit}
                    focused={focusId === r.driver.id} selectedCol={selectedCol}
                    draft={drafts[r.driver.id]} noteState={noteState[r.driver.id]}
                    onFocus={() => setFocusId(r.driver.id)}
                    onDraft={(v) => setDrafts((d) => ({ ...d, [r.driver.id]: v }))}
                    onSaveNote={(v) => saveNote(r, v)}
                    onMenu={(el) => setMenu({ id: r.driver.id, anchor: el })}
                    onRestore={() => run(() => restoreAutoStatus(r.driver.id))}
                  />
                ))}
              </tbody>
            );
          })}
        </table>
        {visible.length === 0 && (
          data.rows.length === 0
            ? <EmptyState title="No active drivers" description="Drivers appear here once they are added and active. Add them under People & partners → Drivers." />
            : <EmptyState title="No drivers match" description="Clear the search or the status filter to see the whole board." action={<Button variant="secondary" size="sm" onClick={() => { setQ(""); setFilter(null); }}>Clear filters</Button>} />
        )}
      </div>

      {menu && menuRow && (
        <RowMenu row={menuRow} anchor={menu.anchor} date={data.date} canEdit={canEdit} onClose={() => setMenu(null)} run={run}
          onHistory={() => { setDrawerId(menuRow.driver.id); setMenu(null); }} />
      )}
      {drawerRow && <DriverDrawer row={drawerRow} now={now} onClose={() => setDrawerId(null)} />}

      {flash && (
        <div role="status" className={cn("fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-md border px-3 py-2 text-[12px] shadow-float",
          flash.tone === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-danger/30 bg-danger-soft text-danger")}>{flash.text}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */

function Row({ r, date, now, liveClock, canEdit, focused, selectedCol, draft, noteState, onFocus, onDraft, onSaveNote, onMenu, onRestore }: {
  r: BoardRow; date: string; now: number; liveClock: boolean; canEdit: boolean; focused: boolean; selectedCol: ColKey | null;
  draft: string | undefined; noteState: "saving" | "saved" | "error" | undefined;
  onFocus: () => void; onDraft: (v: string) => void; onSaveNote: (v: string) => void; onMenu: (el: HTMLElement) => void; onRestore: () => void;
}) {
  const color = r.cell.color;
  const rowStyle = { "--row-bg": color ? ROW_COLOR_BG[color] : "var(--surface)" } as CSSProperties;
  const stickyBg = "linear-gradient(var(--row-bg), var(--row-bg)), var(--surface)";
  const l = r.load;
  const focusRing = focused && "shadow-[inset_0_1px_0_var(--accent),inset_0_-1px_0_var(--accent)]";
  const cell = (key: ColKey, extra?: string) => cn("h-9 border-b border-line px-3 py-1 align-middle bg-(--row-bg)", focusRing, selectedCol === key && "[--row-bg:var(--accent-soft)]", extra);
  const projected = r.statusMode === "projected";

  return (
    <tr data-row={r.driver.id} style={rowStyle} onMouseDown={onFocus} onFocusCapture={onFocus} className={cn("group/row", !color && "hover:[--row-bg:var(--raised)]")}>
      {/* Load */}
      <td className={cn(cell("load"), "sticky left-0 z-10")} style={{ background: stickyBg, width: STICKY_LOAD, minWidth: STICKY_LOAD, maxWidth: STICKY_LOAD }}>
        {focused && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden />}
        {l ? (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link href={`/loads/${l.id}`} className="num truncate font-medium text-fg hover:text-accent-text hover:underline">{l.reference}</Link>
              {!l.hasRc && <Chip tone="warn" title="No rate confirmation on file — upload the RC on the load">No RC</Chip>}
              {(l.priority === "URGENT" || l.priority === "HIGH") && <Chip tone={l.priority === "URGENT" ? "danger" : "warn"}>{l.priority === "URGENT" ? "Urgent" : "High"}</Chip>}
              {r.prebooked && <Chip tone="info" title={`Also prebooked: ${r.prebooked.reference}, pickup ${fmtDateTime(r.prebooked.pickupAt)}`}>+1<span className="sr-only"> prebooked load</span></Chip>}
            </div>
            <div className="truncate text-[11px] text-fg-subtle">{l.customer}</div>
          </div>
        ) : r.prebooked ? (
          // Prebooked (pickup > 24 h out): shown quietly, the driver stays Ready until the pickup is inside 24 h.
          <div className="min-w-0" title={`Prebooked, pickup ${fmtDateTime(r.prebooked.pickupAt)}. The driver stays ready today; the load moves onto the board once pickup is inside 24 hours.`}>
            <Link href={`/loads/${r.prebooked.id}`} className="num block truncate text-fg-muted hover:text-accent-text hover:underline">{r.prebooked.reference}</Link>
            <div className="truncate text-[11px] text-info">Prebooked · <span className="num">{liveClock ? `in ${durationUntil(r.prebooked.pickupAt, now)}` : fmtDayMonth(r.prebooked.pickupAt)}</span></div>
          </div>
        ) : <span className="text-fg-faint">—</span>}
      </td>
      {/* Driver */}
      <td className={cn(cell("driver"), "sticky z-10 border-r border-line")} style={{ background: stickyBg, left: STICKY_LOAD, width: STICKY_DRIVER, minWidth: STICKY_DRIVER, maxWidth: STICKY_DRIVER }}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.team?.color ?? "var(--fg-faint)" }} title={r.team?.name ?? "No team"} />
          <Link href={`/drivers/${r.driver.id}`} className="truncate font-medium text-fg hover:text-accent-text hover:underline">{r.driver.name}</Link>
          <Chip title={DRIVER_TYPE_LABELS[r.driver.type] ?? r.driver.type}>{DRIVER_TYPE_SHORT[r.driver.type] ?? r.driver.type}</Chip>
          {r.driver.hold && <Chip tone="warn" title={r.driver.holdReason ?? "On hold"}>Hold</Chip>}
        </div>
        {r.driver.employment === "ON_LEAVE" && <div className="truncate pl-3 text-[11px] text-fg-subtle">On leave</div>}
      </td>
      {/* Truck */}
      <td className={cell("truck")}>
        {r.truck ? (
          <div className="min-w-0 max-w-[180px]">
            <div className="flex items-center gap-1.5">
              <Link href={`/fleet/${r.truck.id}`} className="num text-fg hover:text-accent-text hover:underline">{r.truck.unitNumber}</Link>
              {r.truck.fuelPct != null && r.truck.fuelPct < 15 && <Chip tone="warn" title="Low fuel">Fuel {Math.round(r.truck.fuelPct)}%</Chip>}
            </div>
            <div className="truncate text-[11px] text-fg-subtle" title={liveClock && r.truck.lastPingAt ? `Last ping ${duration(r.truck.lastPingAt, now)} ago${r.truck.speedKmh ? ` · ${Math.round(r.truck.speedKmh)} km/h` : ""}` : undefined}>
              {r.truck.locationName ?? "No position"}
            </div>
          </div>
        ) : <span className="text-fg-faint">—</span>}
      </td>
      {/* Trailer */}
      <td className={cell("trailer")}>
        {r.trailer ? (
          <div className="min-w-0">
            <div className="num text-fg">{r.trailer.unitNumber}</div>
            <div className="truncate text-[11px] text-fg-subtle">{EQUIPMENT_LABELS[r.trailer.type] ?? r.trailer.type}</div>
          </div>
        ) : <span className="text-fg-faint">—</span>}
      </td>
      {/* Phone */}
      <td className={cn(cell("phone"), "num whitespace-nowrap text-[12px]")}>
        {r.driver.phone ? <a href={`tel:${r.driver.phone.replace(/\s/g, "")}`} className="text-fg hover:text-accent-text hover:underline">{r.driver.phone}</a> : <span className="text-fg-faint">—</span>}
        {r.driver.phone2 && <a href={`tel:${r.driver.phone2.replace(/\s/g, "")}`} title={`Second number: ${r.driver.phone2}`} aria-label={`Second number ${r.driver.phone2}`} className="ml-1.5 rounded-full bg-neutral-soft px-1.5 text-[10.5px] leading-4 text-fg-subtle hover:text-accent-text">+1</a>}
      </td>
      {/* Status */}
      <td className={cell("status")}>
        <div className={cn("flex items-center gap-1.5", projected && "opacity-60")} title={projected ? "This is today's status — the board for a future day isn't live yet" : undefined}>
          <Badge value={r.status} label={BOARD_STATUS_LABELS[r.status as BoardStatus] ?? r.status} dot />
          {r.statusManual && (
            canEdit && r.statusMode === "live"
              ? <button type="button" onClick={onRestore} title="Set by a dispatcher — click to restore the automatic status"
                  className="inline-flex items-center gap-1 rounded border border-transparent bg-accent-soft px-1.5 text-[11px] font-medium leading-4 text-accent-text hover:border-accent/50">
                  Manual <Undo2 className="h-2.5 w-2.5" />
                </button>
              : <Chip tone="accent" title="Set by a dispatcher">Manual</Chip>
          )}
        </div>
      </td>
      {/* Active since */}
      <td className={cn(cell("since"), "num whitespace-nowrap")} title={`Since ${fmtDateTime(r.statusSince)}`}>
        {projected ? <span className="text-fg-faint">—</span> : liveClock ? <span className={cn(r.status === "READY" && now - new Date(r.statusSince).getTime() > 2 * 86_400_000 ? "text-warn" : "text-fg")}>{duration(r.statusSince, now)}</span> : <span className="text-fg-faint">…</span>}
      </td>
      {/* ETA / next */}
      <td className={cn(cell("eta"), "whitespace-nowrap")}>
        <EtaCell l={l} date={date} />
      </td>
      {/* Km */}
      <td className={cn(cell("km"), "num whitespace-nowrap")}>
        {l ? (
          l.status === "IN_TRANSIT" ? (
            <div className="min-w-[88px]">
              <div className="flex items-baseline justify-between gap-2"><span className="text-fg">{number(remainingKm(l))}</span><span className="text-[10px] text-fg-subtle">of {number(Math.round(l.distanceKm))}</span></div>
              <Progress value={l.progress} tone="progress" className="mt-1 h-1" />
            </div>
          ) : <span className="text-fg">{number(Math.round(l.distanceKm))}</span>
        ) : <span className="text-fg-faint">—</span>}
      </td>
      {/* Next stop */}
      <td className={cell("next")}>
        {l?.nextStop ? (
          <div className="flex min-w-0 max-w-[220px] items-center gap-1.5">
            <Chip tone={l.nextStop.status === "ARRIVED" ? "progress" : l.nextStop.type === "PICKUP" ? "info" : "neutral"} title={l.nextStop.status === "ARRIVED" ? "Arrived" : l.nextStop.type === "PICKUP" ? "Pickup" : "Delivery"}>
              {l.nextStop.type === "PICKUP" ? "PU" : "Del"}
            </Chip>
            <div className="min-w-0">
              <div className="truncate text-fg">{l.nextStop.name}</div>
              <div className="truncate text-[11px] text-fg-subtle">{l.nextStop.city}{l.stopsTotal > 2 && <span> · stop {l.stopsDone + 1} of {l.stopsTotal}</span>}</div>
            </div>
          </div>
        ) : l ? <span className="text-[11px] text-fg-subtle">{l.status === "DELIVERED" || l.status === "INVOICED" ? `Delivered ${l.destCity}` : "All stops done"}</span> : <span className="text-fg-faint">—</span>}
      </td>
      {/* Notes */}
      <td className={cn(cell("notes"), "min-w-[240px]")}>
        {canEdit ? (
          <div className="relative">
            <input data-note={r.driver.id} value={draft ?? r.cell.note ?? ""} placeholder="Add a note for this day…" aria-label={`Notes for ${r.driver.name} on ${date}`}
              onChange={(e) => onDraft(e.target.value)}
              onBlur={(e) => { if (draft !== undefined) onSaveNote(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                if (e.key === "Escape") { e.preventDefault(); onDraft(r.cell.note ?? ""); (e.target as HTMLInputElement).blur(); }
              }}
              className="h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-[12px] text-fg placeholder:text-fg-faint hover:border-line focus:border-accent focus:bg-surface focus:outline-none" />
            {noteState && <span className={cn("pointer-events-none absolute right-1.5 top-1.5 text-[10px]", noteState === "error" ? "text-danger" : "text-fg-subtle")}>{noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved" : "Not saved"}</span>}
          </div>
        ) : <span className={cn("block max-w-[320px] truncate text-[12px]", r.cell.note ? "text-fg" : "text-fg-faint")}>{r.cell.note ?? "—"}</span>}
      </td>
      {/* Actions */}
      <td className={cn("h-9 w-10 border-b border-line px-1 text-right bg-(--row-bg)", focusRing)}>
        <IconButton label={`Actions for ${r.driver.name}`} onClick={(e) => onMenu(e.currentTarget)} className="opacity-60 group-hover/row:opacity-100"><Ellipsis /></IconButton>
      </td>
    </tr>
  );
}

function EtaCell({ l, date }: { l: BoardRow["load"]; date: string }) {
  if (!l) return <span className="text-fg-faint">—</span>;
  if (l.status === "IN_TRANSIT") {
    if (!l.eta) return <span className="text-fg-subtle">—</span>;
    const sameDay = ymdOf(l.eta) === date;
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-fg">{l.progress >= 1 ? "Arriving" : <>ETA <span className="num">{hhmm(l.eta)}</span>{!sameDay && <span className="text-fg-subtle"> {fmtDayMonth(l.eta)}</span>}</>}</span>
        {l.late && <Chip tone="danger" title={`Delivery window ${fmtDateTime(l.deliveryAt)}`}>Late {hoursBetween(l.eta, l.deliveryAt)} h</Chip>}
      </div>
    );
  }
  if (l.status === "DELIVERED" || l.status === "INVOICED") {
    return <span className="text-fg-subtle">Delivered <span className="num">{l.deliveredAt ? hhmm(l.deliveredAt) : ""}</span></span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-fg">Pickup <span className="num">{fmtDateTime(l.pickupAt)}</span></span>
      {l.latePickup && <Chip tone="warn" title="Pickup window has passed and the load hasn't departed">Late pickup</Chip>}
    </div>
  );
}

function SummaryPill({ label, count, tone = "neutral", active, onClick }: { label: string; count: number; tone?: Tone; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={segmentedThumb(active)}>
      {tone !== "neutral" && <StatusDot tone={tone} />}
      {label}<span className={cn("num text-[10.5px]", active ? "text-fg-subtle" : "text-fg-faint")}>{count}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Row menu                                                            */
/* ------------------------------------------------------------------ */

function RowMenu({ row, anchor, date, canEdit, onClose, run, onHistory }: {
  row: BoardRow; anchor: HTMLElement; date: string; canEdit: boolean; onClose: () => void;
  run: (fn: () => Promise<ActionState>, opts?: { quiet?: boolean }) => void; onHistory: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<{ status: BoardStatus } | null>(null);
  const [note, setNote] = useState("");
  const phone = row.driver.phone ?? row.driver.phone2;

  if (step) {
    return (
      <Menu anchor={anchor} onClose={onClose} width={260} role="dialog" label={`Set ${row.driver.name} to ${BOARD_STATUS_LABELS[step.status]}`}>
        <div className="p-2">
          <p className="mb-2 text-[12px] text-fg">Set <span className="font-semibold">{row.driver.name}</span> to <Badge value={step.status} label={BOARD_STATUS_LABELS[step.status]} /></p>
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the history (optional)" className={cn(inputClass, "h-7 text-[12px]")}
            aria-label={`Note for setting ${row.driver.name} to ${BOARD_STATUS_LABELS[step.status]}`}
            onKeyDown={(e) => { if (e.key === "Enter") { run(() => setBoardStatus(row.driver.id, step.status, note)); onClose(); } }} />
          <p className="mt-1.5 text-[11px] text-fg-subtle">Overrides the automatic status until you restore it.</p>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setStep(null)}>Back</Button>
            <Button size="sm" onClick={() => { run(() => setBoardStatus(row.driver.id, step.status, note)); onClose(); }}>Set {BOARD_STATUS_LABELS[step.status].toLowerCase()}</Button>
          </div>
        </div>
      </Menu>
    );
  }

  return (
    <Menu anchor={anchor} onClose={onClose}>
      {canEdit && (
        <>
          <MenuLabel>Set status</MenuLabel>
          {MANUAL_BOARD_STATUSES.map((s) => (
            <MenuItem key={s} icon={STATUS_ICON[s]} onClick={() => setStep({ status: s })} disabled={row.status === s && row.statusManual}
              trailing={row.status === s ? <span className="text-[10px] text-fg-subtle">current</span> : undefined}>
              {BOARD_STATUS_LABELS[s]}
            </MenuItem>
          ))}
          {row.statusManual && <MenuItem icon={<Undo2 />} onClick={() => { run(() => restoreAutoStatus(row.driver.id)); onClose(); }}>Restore automatic status</MenuItem>}
          <MenuDivider />
          <MenuLabel>Colour row</MenuLabel>
          <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-0.5">
            {ROW_COLORS.map((c) => (
              <button key={c} type="button" title={ROW_COLOR_LABEL[c]} aria-label={`Colour row ${ROW_COLOR_LABEL[c].toLowerCase()}`}
                onClick={() => { run(() => setRowColor(date, row.driver.id, c), { quiet: true }); onClose(); }}
                className={cn("h-5 w-5 rounded-sm ring-1 ring-line transition-transform hover:scale-110", SWATCH[c], row.cell.color === c && "ring-2 ring-fg ring-offset-1 ring-offset-overlay")} />
            ))}
            <button type="button" title="Clear colour" aria-label="Clear row colour" onClick={() => { run(() => setRowColor(date, row.driver.id, null), { quiet: true }); onClose(); }}
              className="ml-auto inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11px] text-fg-muted hover:bg-raised hover:text-fg"><Eraser className="h-3 w-3" /> Clear</button>
          </div>
          <MenuDivider />
        </>
      )}
      <MenuItem icon={<ClockFading />} onClick={onHistory} shortcut="h">Status history</MenuItem>
      <MenuItem icon={<Package />} disabled={!row.load} onClick={() => { if (row.load) router.push(`/loads/${row.load.id}`); onClose(); }}>Open load{row.load ? ` ${row.load.reference}` : ""}</MenuItem>
      <MenuItem icon={<Users />} onClick={() => { router.push(`/drivers/${row.driver.id}`); onClose(); }}>Open driver</MenuItem>
      {phone && <MenuItem icon={<Phone />} onClick={() => { window.location.href = `tel:${phone.replace(/\s/g, "")}`; onClose(); }}>Call <span className="num">{phone}</span></MenuItem>}
    </Menu>
  );
}

/* ------------------------------------------------------------------ */
/* Driver drawer — details + status history                             */
/* ------------------------------------------------------------------ */

function DriverDrawer({ row, now, onClose }: { row: BoardRow; now: number; onClose: () => void }) {
  const [events, setEvents] = useState<StatusEvent[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/board?history=${row.driver.id}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(); const j = await r.json(); if (alive) setEvents(j.events); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [row.driver.id]);
  const l = row.load;

  return (
    <Drawer title={row.driver.name} onClose={onClose}
      eyebrow={<>{row.team?.name ?? "No team"} · {DRIVER_TYPE_LABELS[row.driver.type] ?? row.driver.type}{row.truck && <> · {row.truck.unitNumber}</>}</>}
      footer={
        <div className="flex flex-wrap gap-2">
          <Link href={`/drivers/${row.driver.id}`} className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium text-fg hover:bg-raised">Open driver</Link>
          {l && <Link href={`/loads/${l.id}`} className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium text-fg hover:bg-raised">Open {l.reference}</Link>}
          {row.driver.phone && <a href={`tel:${row.driver.phone.replace(/\s/g, "")}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium text-fg hover:bg-raised"><Phone className="h-3.5 w-3.5" /> Call</a>}
        </div>
      }>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={row.status} label={BOARD_STATUS_LABELS[row.status as BoardStatus] ?? row.status} dot />
          {row.statusManual && <Chip tone="accent">Manual</Chip>}
          {row.driver.hold && <Chip tone="warn" title={row.driver.holdReason ?? undefined}>Hold</Chip>}
          <span className="num text-[12px] text-fg-muted">{now ? `for ${duration(row.statusSince, now)}` : ""} · since {fmtDateTime(row.statusSince)}</span>
        </div>
        {row.driver.hold && row.driver.holdReason && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">On hold: {row.driver.holdReason}</p>}
        {row.prebooked && (
          <p className="rounded-md bg-info-soft px-3 py-2 text-[12px] text-info">
            Prebooked on <Link href={`/loads/${row.prebooked.id}`} className="num font-medium hover:underline">{row.prebooked.reference}</Link>, pickup <span className="num">{fmtDateTime(row.prebooked.pickupAt)}</span>.
            The driver stays ready today; the load moves onto the board once pickup is inside 24 hours.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
          <Item k="Phone" v={row.driver.phone ? <span className="num">{row.driver.phone}{row.driver.phone2 && <span className="block text-fg-subtle">{row.driver.phone2}</span>}</span> : null} />
          <Item k="Truck" v={row.truck ? <Link href={`/fleet/${row.truck.id}`} className="num hover:underline">{row.truck.unitNumber}</Link> : null} />
          <Item k="Location" v={row.truck?.locationName} hint={row.truck?.lastPingAt ? `ping ${ago(row.truck.lastPingAt)}` : undefined} />
          <Item k="Fuel" v={row.truck?.fuelPct != null ? <span className={cn("num", row.truck.fuelPct < 15 && "text-warn")}>{Math.round(row.truck.fuelPct)}%</span> : null} />
          <Item k="Trailer" v={row.trailer ? <span className="num">{row.trailer.unitNumber} <span className="text-fg-subtle">· {EQUIPMENT_LABELS[row.trailer.type] ?? row.trailer.type}</span></span> : null} />
          <Item k="Team" v={row.team?.name} />
        </dl>

        {l && (
          <section className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/loads/${l.id}`} className="num font-semibold text-fg hover:underline">{l.reference}</Link>
              <div className="flex items-center gap-1.5">{!l.hasRc && <Chip tone="warn">No RC</Chip>}<Badge value={l.status} /></div>
            </div>
            <p className="mt-1 text-[12px] text-fg-muted">{l.originCity} → {l.destCity} · {number(Math.round(l.distanceKm))} km · {l.customer}</p>
            {l.status === "IN_TRANSIT" && (
              <div className="mt-2">
                <Progress value={l.progress} />
                <div className="mt-1 flex justify-between text-[11px] text-fg-subtle">
                  <span>{number(remainingKm(l))} km left</span>
                  <span>ETA {hhmm(l.eta)}{l.late && <span className="text-danger"> · late {hoursBetween(l.eta!, l.deliveryAt)}h</span>}</span>
                </div>
              </div>
            )}
            {l.nextStop && <p className="mt-2 text-[12px] text-fg">Next: {l.nextStop.type === "PICKUP" ? "pickup" : "delivery"} at {l.nextStop.name}, {l.nextStop.city}</p>}
          </section>
        )}

        <section>
          <h3 className="eyebrow mb-2">Status history</h3>
          {error && <p className="text-[12px] text-danger">Could not load the history. Try again in a moment.</p>}
          {!events && !error && <p className="text-[12px] text-fg-subtle">Loading…</p>}
          {events && events.length === 0 && <p className="text-[12px] text-fg-subtle">No status changes recorded yet.</p>}
          {events && events.length > 0 && (
            <ol className="relative ml-1.5 border-l border-line">
              {events.map((e) => (
                <li key={e.id} className="relative mb-3 pl-4 last:mb-0">
                  <span className={cn("absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ring-2 ring-overlay", TONE_DOT[STATUS_TONE[e.status] ?? "neutral"])} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge value={e.status} label={BOARD_STATUS_LABELS[e.status as BoardStatus] ?? e.status} />
                    <Chip tone={e.source === "MANUAL" ? "accent" : "neutral"}>{e.source === "MANUAL" ? "Manual" : "Auto"}</Chip>
                    <span className="num text-[11px] text-fg-subtle">{fmtDateTime(e.at)}</span>
                  </div>
                  {(e.user || e.note) && <p className="mt-0.5 text-[12px] text-fg-muted">{e.user && <span className="text-fg">{e.user}</span>}{e.user && e.note && " — "}{e.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function Item({ k, v, hint }: { k: string; v: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-subtle">{k}</dt>
      <dd className="mt-0.5 truncate text-fg">{v ?? <span className="text-fg-faint">—</span>}{hint && <span className="block text-[11px] text-fg-subtle">{hint}</span>}</dd>
    </div>
  );
}
