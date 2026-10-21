"use client";

import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton, cn } from "@/components/ui";

/**
 * A floating layer over the page: a side drawer (reviews, forms) or a small centred dialog (a note before closing a
 * defect). Escape or a click on the backdrop closes it; the page behind does not scroll while it is open.
 */
export function Overlay({ open = true, onClose, title, subtitle, children, footer, variant = "drawer", wide }: {
  open?: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "drawer" | "dialog";
  /** A wider drawer (the walk-around review). */
  wide?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  // Rendered into <body> (so no animated or scrolling ancestor can shift or clip it), which only exists in the browser.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);

  useEffect(() => {
    if (!open || !inBrowser) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const back = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      back?.focus?.();
    };
  }, [open, inBrowser]);

  if (!open || !inBrowser) return null;
  const drawer = variant === "drawer";
  return createPortal(
    <div className={cn("fade-in fixed inset-0 z-[90] flex bg-scrim backdrop-blur-[1px]", drawer ? "justify-end" : "items-start justify-center p-4 pt-[12vh]")}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
        className={cn("flex max-h-full flex-col bg-overlay shadow-float focus:outline-none",
          drawer ? cn("h-full w-full border-l border-line", wide ? "max-w-3xl" : "max-w-lg") : "pop-in max-h-[76vh] w-full max-w-md rounded-lg border border-line")}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-[12px] text-fg-subtle">{subtitle}</div>}
          </div>
          <IconButton label="Close" onClick={onClose}><X /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-line bg-raised/60 px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

const noSubscribe = () => () => {};

/** A drawer that lives in the URL (`?review=…`): closing it goes to `closeHref`. */
export function UrlDrawer({ closeHref, ...props }: Omit<Parameters<typeof Overlay>[0], "onClose" | "open"> & { closeHref: string }) {
  const router = useRouter();
  return <Overlay {...props} onClose={() => router.replace(closeHref, { scroll: false })} />;
}
