"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Check, ChevronDown, Plus, Search, Store, X } from "lucide-react";
import { VENDOR_TYPES, VENDOR_TYPE_LABELS } from "@/lib/constants";
import { Button, cn, inputClass } from "@/components/ui";
import { createVendorInline } from "@/app/actions/vendors";
import { vendorKey, type VendorOption } from "./shared";

/**
 * Pick the shop for a repair: search the company's vendors, or create one on the spot without leaving the form.
 * Submits `vendorId` (and `vendorName` for an older order that only has a typed shop name until a vendor is picked).
 * Lives inside other forms, so it renders no <form> of its own and its own inputs carry no names.
 */
export function VendorPicker({ vendors, defaultVendorId, legacyName, canCreate = true, name = "vendorId", id, compact }: {
  vendors: VendorOption[];
  defaultVendorId?: string | null;
  /** Shop name typed on an older order that has no vendor yet. */
  legacyName?: string | null;
  canCreate?: boolean;
  name?: string;
  id?: string;
  compact?: boolean;
}) {
  const [list, setList] = useState(vendors);
  const [selected, setSelected] = useState(defaultVendorId ?? "");
  const [legacy, setLegacy] = useState(defaultVendorId ? "" : (legacyName ?? ""));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", type: "SHOP", phone: "", city: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCreating(false); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => { if (open && !creating) searchRef.current?.focus(); }, [open, creating]);

  const current = list.find((v) => v.id === selected);
  const matches = useMemo(() => {
    const q = vendorKey(query);
    return list
      .filter((v) => v.active || v.id === selected)
      .filter((v) => !q || vendorKey(`${v.name} ${v.city ?? ""} ${VENDOR_TYPE_LABELS[v.type] ?? ""}`).includes(q))
      .slice(0, 50);
  }, [list, query, selected]);
  const exact = list.some((v) => vendorKey(v.name) === vendorKey(query));

  const choose = (v: VendorOption | null) => {
    setSelected(v?.id ?? "");
    if (v) setLegacy("");
    setOpen(false);
    setQuery("");
    setCreating(false);
  };
  const startCreate = () => {
    setDraft({ name: query.trim() || legacy, type: "SHOP", phone: "", city: "" });
    setError(null);
    setCreating(true);
  };
  const create = () =>
    start(async () => {
      setError(null);
      try {
        const res = await createVendorInline(draft);
        if (res.error || !res.vendor) { setError(res.error ?? "Could not create the vendor"); return; }
        const v = res.vendor;
        setList((l) => (l.some((x) => x.id === v.id) ? l : [...l, v].sort((a, b) => a.name.localeCompare(b.name))));
        choose(v);
      } catch {
        setError("Could not create the vendor. Try again.");
      }
    });

  // Enter inside the picker must never submit the form around it.
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches.length === 1) choose(matches[0]);
      else if (canCreate && query.trim() && !exact) startCreate();
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };
  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); if (draft.name.trim()) create(); }
    if (e.key === "Escape") { e.preventDefault(); setCreating(false); }
  };

  return (
    <div ref={ref} className="relative">
      <input type="hidden" name={name} value={selected} />
      {!selected && legacy && <input type="hidden" name="vendorName" value={legacy} />}
      <button type="button" id={id} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn(inputClass, "flex items-center gap-2 text-left", compact && "h-7 text-[12px]")}>
        <Store className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate", !current && !legacy && "text-fg-faint")}>
          {current ? current.name : legacy ? <>{legacy} <span className="text-fg-subtle">· typed, not a vendor yet</span></> : "Pick a shop…"}
        </span>
        {current?.city && <span className="hidden shrink-0 text-[11px] text-fg-subtle sm:inline">{current.city}</span>}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
      </button>

      {open && (
        <div className="pop-in absolute left-0 right-0 top-full z-40 mt-1 min-w-64 rounded-lg border border-line bg-overlay shadow-float">
          {creating ? (
            <div className="space-y-2 p-3">
              <p className="text-[12px] font-medium text-fg">New vendor</p>
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={onDraftKey} placeholder="Shop name" aria-label="Vendor name" className={inputClass} />
              <div className="grid grid-cols-2 gap-2">
                <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} aria-label="Vendor type" className={inputClass}>
                  {VENDOR_TYPES.map((t) => <option key={t} value={t}>{VENDOR_TYPE_LABELS[t]}</option>)}
                </select>
                <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} onKeyDown={onDraftKey} placeholder="City" aria-label="City" className={inputClass} />
              </div>
              <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} onKeyDown={onDraftKey} placeholder="Phone" aria-label="Phone" inputMode="tel" className={inputClass} />
              {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Back</Button>
                <Button size="sm" variant="secondary" disabled={pending || !draft.name.trim()} onClick={create}>{pending ? "Creating…" : "Create and pick"}</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
                  placeholder="Search shops" aria-label="Search shops" className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-faint focus:outline-none" />
              </div>
              <ul role="listbox" aria-label="Vendors" className="max-h-64 overflow-auto py-1">
                {matches.map((v) => (
                  <li key={v.id}>
                    <button type="button" role="option" aria-selected={v.id === selected} onClick={() => choose(v)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-raised">
                      <span className="min-w-0 flex-1 truncate text-fg">{v.name}</span>
                      <span className="shrink-0 text-[11px] text-fg-subtle">{[VENDOR_TYPE_LABELS[v.type], v.city].filter(Boolean).join(" · ")}</span>
                      {v.id === selected && <Check className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />}
                    </button>
                  </li>
                ))}
                {matches.length === 0 && (
                  <li className="px-3 py-2 text-[12px] text-fg-muted">{list.length ? "No shop matches." : "No vendors yet."}{canCreate ? " Create it below." : ""}</li>
                )}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
                {(selected || legacy) ? (
                  <button type="button" onClick={() => { setLegacy(""); choose(null); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-fg-muted hover:bg-raised hover:text-fg">
                    <X className="h-3.5 w-3.5" />No shop
                  </button>
                ) : <span />}
                {canCreate && (
                  <button type="button" onClick={startCreate} className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">
                    <Plus className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{query.trim() && !exact ? `Create “${query.trim()}”` : "Create vendor"}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
