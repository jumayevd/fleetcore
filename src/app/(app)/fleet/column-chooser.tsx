"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Columns3, RotateCcw } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";
import { Popover } from "./menu";

export type ColumnDef = {
  key: string;
  label: string;
  /** Hidden until the person turns it on. */
  hidden?: boolean;
};

/*
 * Which columns a person wants, remembered in this browser (localStorage). Storage can be missing or throw (private
 * windows, blocked site data): then the choice lasts until the page is reloaded and the table still renders.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string | null) {
  if (value == null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the in-memory copy above keeps the choice for this visit.
  }
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key == null || e.key.startsWith("fleetcore:")) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

function parse(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/**
 * "Columns" button for a server-rendered table. Cells carry `data-col="<key>"` (header cells wrap their label in a
 * `<span data-col>`); this hides the ones turned off with a scoped style, so rows stay server components.
 */
export function ColumnChooser({ tableId, storageKey, columns }: { tableId: string; storageKey: string; columns: ColumnDef[] }) {
  const key = `fleetcore:${storageKey}`;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const choice = useMemo(() => parse(raw), [raw]);
  const visible = (c: ColumnDef) => choice[c.key] ?? !c.hidden;
  const hidden = columns.filter((c) => !visible(c)).map((c) => c.key);
  const customised = Object.keys(choice).length > 0;
  const css = hidden
    .map((k) => `#${tableId} td[data-col="${k}"],#${tableId} th:has(>[data-col="${k}"]){display:none}`)
    .join("");

  const toggle = (c: ColumnDef) => {
    const next = { ...choice, [c.key]: !visible(c) };
    // Back to the default for this column: forget it, so later default changes still apply.
    if (next[c.key] === !c.hidden) delete next[c.key];
    write(key, Object.keys(next).length ? JSON.stringify(next) : null);
  };

  return (
    <>
      <style>{css}</style>
      <Popover width={232} align="end" trigger={({ open, toggle: t }) => (
        <button type="button" onClick={t} aria-haspopup="dialog" aria-expanded={open}
          className={cn(buttonClass("secondary"), (open || customised) && "border-line-strong bg-raised")}>
          <Columns3 />Columns
          {customised && <span className="num rounded-full bg-accent px-1.5 text-[10.5px] font-semibold leading-4 text-on-accent">{columns.length - hidden.length}</span>}
        </button>
      )}>
        {() => (
          <div role="dialog" aria-label="Columns">
            <p className="px-2 pb-1 pt-1 text-[11px] text-fg-subtle">Show columns · remembered on this device</p>
            <ul className="max-h-80 space-y-px overflow-y-auto">
              {columns.map((c) => (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-fg hover:bg-raised">
                    <input type="checkbox" checked={visible(c)} onChange={() => toggle(c)} className="h-4 w-4 rounded border-line-strong accent-[var(--accent)]" />
                    <span className="flex-1">{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            {customised && (
              <div className="mt-1 border-t border-line pt-1">
                <button type="button" onClick={() => write(key, null)} className={cn(buttonClass("ghost", "sm"), "w-full justify-start")}>
                  <RotateCcw />Back to the default columns
                </button>
              </div>
            )}
          </div>
        )}
      </Popover>
    </>
  );
}
