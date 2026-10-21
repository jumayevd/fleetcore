"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, MoreHorizontal, Pencil, RefreshCw, ShieldAlert } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";
import { openRecoverPanel } from "./[id]/recover-details";

type Item = { key: string; label: string; icon: ReactNode; href?: string; onSelect?: () => void; hint?: string };

/**
 * Row actions for a load. Renders as a fixed-position menu so it never gets clipped by the
 * table's scroll container; closes on outside click, Escape, scroll and resize.
 */
export function LoadRowMenu({ id, reference, status, canEdit, canClaim, trigger = "icon", context = "list" }: {
  id: string; reference: string; status: string; canEdit: boolean; canClaim: boolean;
  /** `icon` for table rows, `button` for page headers. */
  trigger?: "icon" | "button";
  /** On the load's own page "Open" and "Edit" are redundant (Edit is a header button), so they are left out. */
  context?: "list" | "detail";
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const onDetail = context === "detail";
  const items: Item[] = [
    ...(onDetail ? [] : [{ key: "open", label: "Open", icon: <ExternalLink />, href: `/loads/${id}` }]),
    ...(canEdit && !onDetail && status !== "INVOICED" ? [{ key: "edit", label: "Edit", icon: <Pencil />, href: `/loads/${id}/edit` }] : []),
    ...(canEdit && (status === "ASSIGNED" || status === "IN_TRANSIT")
      ? [{ key: "recover", label: "Recover to another unit", icon: <RefreshCw />, href: `/loads/${id}#recover`, hint: "Breakdown, HOS, swap" }]
      : []),
    ...(canClaim ? [{ key: "claim", label: "File a claim", icon: <ShieldAlert />, href: `/claims/new?load=${id}` }] : []),
    {
      key: "copy", label: copied ? "Copied" : "Copy reference", icon: copied ? <Check /> : <Copy />,
      onSelect: () => {
        navigator.clipboard?.writeText(reference).then(() => {
          setCopied(true);
          setTimeout(() => { setCopied(false); setOpen(false); }, 900);
        }).catch(() => setOpen(false));
      },
    },
  ];

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = 224, height = 8 + items.length * 32;
    const flipUp = r.bottom + height + 8 > window.innerHeight;
    setPos({ top: flipUp ? r.top - height - 4 : r.bottom + 4, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || btn.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); btn.current?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const focusables = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
        if (!focusables.length) return;
        e.preventDefault();
        const i = focusables.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? (i + 1) % focusables.length : (i - 1 + focusables.length) % focusables.length;
        focusables[next].focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const itemClass = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg outline-none hover:bg-raised focus-visible:bg-raised [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-fg-subtle";

  return (
    <>
      <button
        ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${reference}`} title="Actions"
        onClick={() => { if (!open) place(); setOpen((o) => !o); }}
        className={trigger === "button"
          ? buttonClass("secondary")
          : "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-sunken hover:text-fg aria-expanded:bg-sunken aria-expanded:text-fg"}
      >
        <MoreHorizontal className="h-4 w-4" />{trigger === "button" && <span>More</span>}
      </button>
      {open && pos && (
        <div ref={menu} id={menuId} role="menu" aria-label={`Actions for ${reference}`}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 224 }}
          className="z-50 rounded-md border border-line bg-overlay p-1 shadow-float">
          {items.map((it) =>
            it.href ? (
              <Link key={it.key} role="menuitem" href={it.href} className={itemClass} onClick={() => { if (it.key === "recover") openRecoverPanel(); setOpen(false); }}>
                {it.icon}<span className="flex-1">{it.label}</span>{it.hint && <span className="text-[10px] text-fg-faint">{it.hint}</span>}
              </Link>
            ) : (
              <button key={it.key} type="button" role="menuitem" className={cn(itemClass, copied && it.key === "copy" && "text-ok [&_svg]:text-ok")} onClick={it.onSelect}>
                {it.icon}<span className="flex-1">{it.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
