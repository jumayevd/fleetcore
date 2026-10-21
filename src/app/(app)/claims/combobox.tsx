"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn, inputClass } from "@/components/ui";
import type { ComboOption } from "./shared";

const LIMIT = 60;

/**
 * Searchable select: type to filter by label, hint or keywords; arrow keys + Enter to pick.
 * The chosen id travels in a hidden input named `name`, so it works inside a plain ActionForm.
 */
export function Combobox({ name, options, value, onChange, placeholder = "Search…", disabled, emptyText = "No matches", mono, className, inputId }: {
  name: string;
  options: ComboOption[];
  value: string;
  onChange: (id: string, option: ComboOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  /** Labels are codes (unit numbers, load references) — render them in the mono face. */
  mono?: boolean;
  className?: string;
  inputId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, LIMIT);
    const terms = q.split(/\s+/);
    return options.filter((o) => {
      const hay = `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    }).slice(0, LIMIT);
  }, [options, query]);

  const show = (q = "") => { setQuery(q); setActive(0); setOpen(true); };
  const hide = () => { setOpen(false); setQuery(""); };
  const pick = (o: ComboOption) => { onChange(o.id, o); hide(); };
  const clear = () => { onChange("", null); hide(); input.current?.focus(); };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return show();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const o = results[active];
      if (o) pick(o);
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); hide(); }
    } else if (e.key === "Backspace" && !open && selected) {
      // Backspace on a chosen value clears it and starts a new search.
      e.preventDefault();
      onChange("", null);
      show();
    } else if (e.key === "Tab") {
      hide();
    }
  };

  const activeId = open && results[active] ? `${listId}-${active}` : undefined;

  return (
    <div ref={wrap} className={cn("relative", className)}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node | null)) hide(); }}>
      <input type="hidden" name={name} value={value} />
      <div className="relative">
        <input
          ref={input} id={inputId} type="text" role="combobox" autoComplete="off" spellCheck={false}
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeId}
          value={open ? query : selected?.label ?? ""}
          placeholder={selected ? selected.label : placeholder}
          disabled={disabled}
          onChange={(e) => show(e.target.value)}
          onClick={() => { if (!open) show(); }}
          onKeyDown={onKeyDown}
          className={cn(inputClass, "pr-14", mono && selected && !open && "num", selected && !open && "font-medium")}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {selected && !disabled && (
            <button type="button" tabIndex={-1} onClick={clear} aria-label="Clear selection"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-sunken hover:text-fg">
              <X className="h-3 w-3" />
            </button>
          )}
          <ChevronDown className={cn("mr-1 h-3.5 w-3.5 text-fg-subtle transition-transform", open && "rotate-180")} aria-hidden />
        </div>
      </div>
      {selected?.hint && !open && <p className="mt-1 truncate text-[11px] text-fg-subtle">{selected.hint}</p>}

      {open && (
        <ul id={listId} role="listbox" tabIndex={-1}
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-overlay p-1 shadow-float">
          {results.length === 0 ? (
            <li className="px-2 py-2 text-[12px] text-fg-muted">{emptyText}</li>
          ) : results.map((o, i) => (
            <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={o.id === value}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}
              className={cn("flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[13px] text-fg", i === active && "bg-raised")}>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", mono && "num", o.id === value && "font-medium")}>{o.label}</span>
                {o.hint && <span className="block truncate text-[11px] text-fg-subtle">{o.hint}</span>}
              </span>
              {o.id === value && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />}
            </li>
          ))}
          {results.length === LIMIT && <li className="px-2 pb-1 pt-1.5 text-[11px] text-fg-faint">Showing the first {LIMIT} — keep typing to narrow the list</li>}
        </ul>
      )}
    </div>
  );
}
