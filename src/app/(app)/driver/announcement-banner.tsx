"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Megaphone, X } from "lucide-react";

// The dismissed announcement id lives in localStorage; exposed as an external store so there is no setState-in-effect.
const KEY = "fleetops.driver.announcement.dismissed";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ } listeners.forEach((l) => l()); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** Latest pinned announcement. Dismissing hides that one until a newer pinned announcement replaces it. */
export function AnnouncementBanner({ id, title, body, meta }: { id: string; title: string; body: string; meta: string }) {
  const dismissed = useSyncExternalStore(subscribe, read, () => null);
  if (dismissed === id) return null;
  return (
    <section role="status" aria-label="Pinned announcement" className="flex items-start gap-3 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-5 text-fg">{title}</p>
        <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[13px] leading-5 text-fg-muted">{body}</p>
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          {meta} · <Link href="/announcements" className="underline-offset-2 hover:text-fg hover:underline">All announcements</Link>
        </p>
      </div>
      <button type="button" onClick={() => write(id)} aria-label="Dismiss announcement"
        className="-mr-2 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface/60 hover:text-fg">
        <X className="h-4 w-4" />
      </button>
    </section>
  );
}
