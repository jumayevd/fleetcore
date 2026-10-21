"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";
import { OVERVIEW_COOKIE, OVERVIEW_SECTIONS, type OverviewSection } from "./sections";

/** Persist the hidden sections for a year. */
function writeHidden(keys: Set<OverviewSection>) {
  document.cookie = `${OVERVIEW_COOKIE}=${[...keys].join(",")}; path=/; max-age=31536000; samesite=lax`;
}

/** "Customize" menu on Today: a switch per section. Saved in this browser; the page re-renders without them. */
export function CustomizeOverview({ hidden: initial }: { hidden: OverviewSection[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => new Set(initial));
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const save = (next: Set<OverviewSection>) => {
    setHidden(next);
    writeHidden(next);
    start(() => router.refresh());
  };
  const toggle = (key: OverviewSection) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    save(next);
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass("secondary")}>
        <SlidersHorizontal className={cn(pending && "animate-pulse")} />Customize
      </button>
      {open && (
        <div className="pop-in absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-line bg-overlay shadow-float">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <p className="text-[13px] font-semibold text-fg">Show on Today</p>
            {hidden.size > 0 && (
              <button type="button" onClick={() => save(new Set())} className="text-[12px] font-medium text-accent-text hover:underline">Show all</button>
            )}
          </div>
          <ul className="px-2 pb-2">
            {OVERVIEW_SECTIONS.map((s) => {
              const on = !hidden.has(s.key);
              return (
                <li key={s.key}>
                  <button type="button" role="switch" aria-checked={on} onClick={() => toggle(s.key)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-raised">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-fg">{s.label}</span>
                      <span className="block truncate text-[12px] text-fg-subtle">{s.hint}</span>
                    </span>
                    <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200", on ? "bg-accent" : "bg-line-strong")}>
                      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-on-accent shadow-card transition-transform duration-200", on ? "translate-x-[1.125rem]" : "translate-x-0.5")} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-4 py-2 text-[11px] text-fg-subtle">Saved in this browser. Hidden sections aren&apos;t loaded, so the page gets faster too.</p>
        </div>
      )}
    </div>
  );
}
