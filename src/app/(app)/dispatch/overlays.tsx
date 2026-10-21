"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn, IconButton } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Focus helpers                                                       */
/* ------------------------------------------------------------------ */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
const menuItems = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];

/** Keep Tab / Shift+Tab inside `root` (portalled layers sit at the end of <body>, so Tab would otherwise leave them). */
function trapTab(e: ReactKeyboardEvent, root: HTMLElement | null) {
  if (e.key !== "Tab" || !root) return;
  const list = focusables(root);
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
}

/* ------------------------------------------------------------------ */
/* Menu — floating, portalled so table overflow never clips it         */
/* ------------------------------------------------------------------ */

/**
 * Focus moves to the first item on open and back to `anchor` on close; arrows, Home and End move between items, Tab stays
 * inside, Esc closes. `role="dialog"` (with `label`) suits a small form shown in the same floating layer.
 */
export function Menu({ anchor, onClose, children, width = 224, className, role = "menu", label }: {
  anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number; className?: string;
  role?: "menu" | "dialog"; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 320;
      const below = r.bottom + 4 + h <= window.innerHeight - 8;
      const top = below ? r.bottom + 4 : Math.max(8, r.top - 4 - h);
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [anchor, onClose]);

  // Move focus in on open (unless something inside already took it, e.g. an autoFocus input) and hand it back on close,
  // but only when it is still inside the menu or was dropped: never steal it from whatever the user clicked next.
  useEffect(() => {
    const node = ref.current;
    if (!node || !anchor) return;
    if (!node.contains(document.activeElement)) (menuItems(node)[0] ?? focusables(node)[0])?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || node.contains(active)) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    if (e.key === "Tab") { trapTab(e, node); return; }
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
    const items = menuItems(node);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length].focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i === -1 ? items.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
  };

  if (!anchor || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} role={role} aria-label={label} aria-modal={role === "dialog" ? true : undefined} onKeyDown={onKeyDown}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className={cn("fixed z-[90] overflow-hidden rounded-lg border border-line bg-overlay p-1 shadow-float", className)}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, danger, disabled, shortcut, trailing }: {
  icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean; shortcut?: string; trailing?: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] outline-none disabled:opacity-40",
        danger ? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft" : "text-fg hover:bg-raised focus-visible:bg-raised",
        "[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle")}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
      {shortcut && <kbd className="num rounded border border-line bg-sunken px-1 text-[10px] text-fg-subtle">{shortcut}</kbd>}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="eyebrow px-2 pb-1 pt-1.5">{children}</p>;
}
export function MenuDivider() {
  return <div className="my-1 border-t border-line" />;
}

/* ------------------------------------------------------------------ */
/* Drawer — right side panel                                           */
/* ------------------------------------------------------------------ */

/** Modal side panel: focus starts on Close, Tab stays inside, Esc or the scrim closes, focus returns to where it was. */
export function Drawer({ title, eyebrow, onClose, children, footer, width = 420 }: {
  title: ReactNode; eyebrow?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Mount-only: initial focus, scroll lock, and focus restore on close (onClose changes identity every board render).
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal aria-labelledby={titleId}>
      {/* Scrim from tokens only: graphite text colour by day, canvas by night. */}
      <div className="absolute inset-0 bg-scrim backdrop-blur-[1px]" onClick={onClose} />
      <aside ref={panelRef} onKeyDown={(e) => trapTab(e, panelRef.current)} style={{ width: `min(${width}px, 100vw)` }}
        className="absolute inset-y-0 right-0 flex flex-col border-l border-line bg-overlay shadow-float">
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-0.5">{eyebrow}</p>}
            <h2 id={titleId} className="truncate text-[15px] font-semibold text-fg">{title}</h2>
          </div>
          <IconButton ref={closeRef} label="Close" onClick={onClose}><X /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="border-t border-line px-4 py-3">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}
