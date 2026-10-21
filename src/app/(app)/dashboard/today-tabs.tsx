"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cardClass, cn, segmentedThumb, segmentedTrack } from "@/components/ui";

export type CardTab = { key: string; label: string; count?: number; more?: { href: string; label: string }; content: ReactNode };

/**
 * One card, one list at a time (pickups, activity). The panels are rendered on the server; switching tabs only
 * changes which one is shown, so nothing refetches. Arrow keys move between tabs.
 */
export function TabbedCard({ tabs, label, className }: { tabs: CardTab[]; label: string; className?: string }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const id = useId();
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setActive(next.key);
    document.getElementById(`${id}-tab-${next.key}`)?.focus();
  };
  if (!current) return null;
  return (
    <section className={cn(cardClass, "flex min-w-0 flex-col", className)}>
      <header className="flex min-h-12 items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div role="tablist" aria-label={label} className={segmentedTrack}>
          {tabs.map((t, i) => {
            const on = t.key === current.key;
            return (
              <button key={t.key} id={`${id}-tab-${t.key}`} type="button" role="tab" aria-selected={on} aria-controls={`${id}-panel-${t.key}`}
                tabIndex={on ? 0 : -1} onClick={() => setActive(t.key)} onKeyDown={(e) => onKey(e, i)} className={segmentedThumb(on)}>
                {t.label}
                {t.count != null && <span className={cn("num text-[10.5px]", on ? "text-fg-subtle" : "text-fg-faint")}>{t.count}</span>}
              </button>
            );
          })}
        </div>
        {current.more && (
          <Link href={current.more.href} className="whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">{current.more.label} →</Link>
        )}
      </header>
      {tabs.map((t) => (
        <div key={t.key} id={`${id}-panel-${t.key}`} role="tabpanel" aria-labelledby={`${id}-tab-${t.key}`} hidden={t.key !== current.key} className="fade-in min-w-0 flex-1 border-t border-line">
          {t.content}
        </div>
      ))}
    </section>
  );
}
