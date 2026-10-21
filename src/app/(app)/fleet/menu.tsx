"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Popover — floating layer rendered in a portal so table overflow     */
/* never clips it. Closes on outside click / Escape, follows scroll.   */
/* ------------------------------------------------------------------ */

export function Popover({ trigger, children, width = 208, align = "end", className }: {
  /** Render the trigger and wire `toggle` to its onClick — the panel anchors to the element that was clicked. */
  trigger: (api: { open: boolean; toggle: (e: MouseEvent<HTMLElement>) => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback((e: MouseEvent<HTMLElement>) => { setAnchor(e.currentTarget); setOpen((o) => !o); }, []);

  const place = useCallback(() => {
    const b = anchor?.getBoundingClientRect();
    if (!b) return;
    const panelH = panelRef.current?.offsetHeight ?? 0;
    const below = window.innerHeight - b.bottom;
    const top = panelH && below < panelH + 8 && b.top > panelH + 8 ? b.top - panelH - 4 : b.bottom + 4;
    const left = Math.max(8, Math.min(align === "end" ? b.right - width : b.left, window.innerWidth - width - 8));
    setPos({ position: "fixed", top, left, width });
  }, [anchor, align, width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { close(); anchor?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, close, place]);

  return (
    <>
      {trigger({ open, toggle })}
      {open && createPortal(
        <div ref={panelRef} data-no-row-link="" style={pos ?? { position: "fixed", top: -9999, left: -9999, width }}
          className={cn("z-[1000] rounded-md border border-line bg-overlay p-1 text-[13px] text-fg shadow-float", className)}>
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* DropMenu — row / header action menus                                */
/* ------------------------------------------------------------------ */

export type MenuItem = {
  label: ReactNode;
  href?: string;
  onSelect?: () => void;
  icon?: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
};

export const menuItemClass =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-fg hover:bg-raised focus:bg-raised focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle";

/** Keyboard behaviour for a role="menu" list: focus the first enabled item on mount, ↑ / ↓ move between enabled items. */
export function useMenuKeys() {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus(); }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
    if (!els.length) return;
    e.preventDefault();
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  };
  return { ref, onKeyDown };
}

function MenuList({ items, close }: { items: MenuItem[]; close: () => void }) {
  const { ref, onKeyDown } = useMenuKeys();
  return (
    <ul ref={ref} role="menu" onKeyDown={onKeyDown} className="space-y-px">
      {items.map((it, i) => {
        const inner = (
          <>
            {it.icon}
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && <span className="num text-[11px] text-fg-subtle">{it.hint}</span>}
          </>
        );
        const cls = cn(menuItemClass, it.danger && "text-danger [&_svg]:text-danger");
        return (
          <li key={i} role="none">
            {it.href && !it.disabled
              ? <Link role="menuitem" href={it.href} onClick={close} className={cls}>{inner}</Link>
              : <button type="button" role="menuitem" disabled={it.disabled} onClick={() => { it.onSelect?.(); close(); }} className={cls}>{inner}</button>}
          </li>
        );
      })}
    </ul>
  );
}

export function DropMenu({ items, children, className, label, width = 208, align = "end" }: {
  items: MenuItem[];
  /** Trigger contents. */
  children: ReactNode;
  /** Trigger classes (e.g. buttonClass("secondary")). */
  className?: string;
  label?: string;
  width?: number;
  align?: "start" | "end";
}) {
  return (
    <Popover width={width} align={align} trigger={({ open, toggle }) => (
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={toggle} className={className}>
        {children}
      </button>
    )}>
      {(close) => <MenuList items={items} close={close} />}
    </Popover>
  );
}
