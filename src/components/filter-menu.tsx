"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { buttonClass, cn } from "./ui";

/**
 * "Filters" button with a count of what is applied; the controls open in a popover instead of filling a row.
 * Closes on Escape or a click outside. The controls themselves stay the page's own (they write to the URL).
 */
export function FilterMenu({ count, children, onClear, label = "Filters", align = "left" }: {
  count: number; children: ReactNode; onClear?: () => void; label?: string; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
        className={cn(buttonClass("secondary"), (open || count > 0) && "border-line-strong bg-raised")}>
        <SlidersHorizontal />{label}
        {count > 0 && <span className="num rounded-full bg-accent px-1.5 text-[10.5px] font-semibold leading-4 text-on-accent">{count}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={label}
          className={cn("pop-in absolute top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-overlay shadow-float", align === "right" ? "right-0" : "left-0")}>
          <div className="space-y-3 p-3">{children}</div>
          {onClear && count > 0 && (
            <div className="flex justify-end border-t border-line px-3 py-2">
              <button type="button" onClick={() => { onClear(); setOpen(false); }} className={buttonClass("ghost", "sm")}><X />Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Labelled control inside a FilterMenu. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

/** An applied filter shown next to the button, removable in one click. */
export function FilterChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="fade-in inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface pl-2.5 pr-1 text-[12px] font-medium text-fg-muted shadow-card">
      {children}
      <button type="button" onClick={onRemove} aria-label="Remove filter"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-sunken hover:text-fg">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
