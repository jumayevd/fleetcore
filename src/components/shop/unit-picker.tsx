"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Container, Search, Truck as TruckIcon } from "lucide-react";
import { cn, inputClass } from "@/components/ui";

export type PickableUnit = { id: string; unitNumber: string; detail: string };

/** Lower-case, spaces squashed, and unit numbers without their leading zeros ("0045" is found by "45"). */
const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const bare = (s: string) => key(s).replace(/^0+(?=\d)/, "");

/**
 * Pick a truck or trailer by typing: the unit number (leading zeros optional), make, model or driver. Exact and
 * starting matches of the unit number come first. Arrow keys move, Enter picks, Escape closes. Lives inside other
 * forms: submits `name` through a hidden field, which also carries `required` so the form can't be sent without one.
 */
export function UnitPicker({ kind, units, name, value, onChange, required, id }: {
  kind: "truck" | "trailer";
  units: PickableUnit[];
  name: string;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const Icon = kind === "truck" ? TruckIcon : Container;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);

  const current = units.find((u) => u.id === value);
  const matches = useMemo(() => {
    const q = key(query);
    if (!q) return units;
    const qb = bare(q);
    const rank = (u: PickableUnit) => {
      const n = bare(u.unitNumber);
      if (n === qb) return 0;
      if (n.startsWith(qb)) return 1;
      if (n.includes(qb)) return 2;
      return key(`${u.unitNumber} ${u.detail}`).includes(q) ? 3 : -1;
    };
    return units.map((u) => ({ u, r: rank(u) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).map((x) => x.u);
  }, [units, query]);

  const show = () => {
    setQuery("");
    setActive(Math.max(0, units.findIndex((u) => u.id === value)));
    setOpen(true);
  };
  const choose = (u: PickableUnit) => {
    onChange(u.id);
    setOpen(false);
    setQuery("");
  };
  const move = (to: number) => {
    const next = Math.max(0, Math.min(matches.length - 1, to));
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };
  // Enter inside the picker must never submit the form around it.
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (matches[active]) choose(matches[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  return (
    <div ref={ref} className="relative">
      {/* Carries the value, and `required` (a hidden input can't be): the browser points at the picker when it is empty. */}
      <input name={name} value={value} required={required} onChange={() => {}} tabIndex={-1} aria-hidden
        onInvalid={() => show()} className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
      <button type="button" id={id} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}
        className={cn(inputClass, "relative flex items-center gap-2 text-left")}>
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-fg-faint")}>
          {current ? <><span className="num font-medium text-fg">{current.unitNumber}</span> <span className="text-fg-muted">· {current.detail}</span></> : `Pick a ${kind}…`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
      </button>

      {open && (
        <div className="pop-in absolute left-0 right-0 top-full z-40 mt-1 min-w-64 rounded-lg border border-line bg-overlay shadow-float">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
            <input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); listRef.current?.scrollTo({ top: 0 }); }} onKeyDown={onSearchKey}
              placeholder={`Search ${kind}s: unit number, make or driver`} aria-label={`Search ${kind}s`}
              className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-faint focus:outline-none" />
          </div>
          <ul ref={listRef} role="listbox" aria-label={kind === "truck" ? "Trucks" : "Trailers"} className="max-h-72 overflow-auto py-1">
            {matches.map((u, i) => (
              <li key={u.id}>
                <button type="button" role="option" aria-selected={u.id === value} onClick={() => choose(u)} onMouseEnter={() => setActive(i)}
                  className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]", i === active ? "bg-raised" : "hover:bg-raised")}>
                  <span className="num w-14 shrink-0 font-medium text-fg">{u.unitNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{u.detail}</span>
                  {u.id === value && <Check className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />}
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-3 py-2 text-[12px] text-fg-muted">{units.length ? `No ${kind} matches “${query.trim()}”.` : `No ${kind}s yet.`}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
