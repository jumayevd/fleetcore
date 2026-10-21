"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/components/ui";

/* Floating menu for row actions and the status "More" button. Rendered in a portal so table
   overflow never clips it; closes on outside click, Escape, scroll and resize. */

export type MenuItem = {
  label: ReactNode;
  href?: string;
  /** Gets the menu's trigger button, e.g. to return focus there from a dialog the item opens. */
  onSelect?: (trigger: HTMLButtonElement | null) => void;
  icon?: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
};

const itemClass =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-fg hover:bg-raised focus:bg-raised focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle";

export function DropMenu({ items, children, className, label, width = 224, align = "end" }: {
  items: MenuItem[];
  /** Trigger contents. */
  children: ReactNode;
  /** Trigger classes (e.g. buttonClass("secondary")). */
  className?: string;
  label?: string;
  width?: number;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const h = panel.current?.offsetHeight ?? 0;
    const top = h && window.innerHeight - b.bottom < h + 8 && b.top > h + 8 ? b.top - h - 4 : b.bottom + 4;
    const left = Math.max(8, Math.min(align === "end" ? b.right - width : b.left, window.innerWidth - width - 8));
    setPos({ position: "fixed", top, left, width });
  }, [align, width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { close(); btn.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = Array.from(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
    if (!els.length) return;
    e.preventDefault();
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  };

  return (
    <>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
        onClick={() => setOpen((o) => !o)} className={className}>
        {children}
      </button>
      {open && createPortal(
        <div ref={panel} data-no-row-link="" style={pos ?? { position: "fixed", top: -9999, left: -9999, width }}
          className="z-[1000] rounded-md border border-line bg-overlay p-1 text-[13px] text-fg shadow-float">
          <ul ref={list} role="menu" onKeyDown={onKeyDown} className="space-y-px">
            {items.map((it, i) => {
              const inner = (
                <>
                  {it.icon}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-[11px] text-fg-subtle">{it.hint}</span>}
                </>
              );
              const cls = cn(itemClass, it.danger && "text-danger [&_svg]:text-danger");
              return (
                <li key={i} role="none">
                  {it.href && !it.disabled
                    ? <Link role="menuitem" href={it.href} onClick={close} className={cls}>{inner}</Link>
                    : <button type="button" role="menuitem" disabled={it.disabled} onClick={() => { close(); it.onSelect?.(btn.current); }} className={cls}>{inner}</button>}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
