"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often an open page asks for an ELD sync. */
const TICK_MS = 5_000;
/** A company without an ELD connection: ask now and then, in case one is added. */
const IDLE_MS = 60_000;

/** Someone is typing: a refresh waits for them to leave the field. */
const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/**
 * Keeps ELD readings live on every page: while FleetCore is open and on screen, it asks for a sync every 5 s
 * (/api/eld/tick; the server runs at most one per company in that time, however many pages ask) and refreshes the
 * page when a sync changed a reading. A hidden tab stops asking and catches up the moment it is shown again.
 */
export function EldHeartbeat() {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** The change the page last caught up with (undefined until the first answer). */
    let seen: string | null | undefined;
    let due = false;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    };
    async function tick() {
      if (document.visibilityState !== "visible") return;
      let next = TICK_MS;
      try {
        const res = await fetch("/api/eld/tick", { cache: "no-store" });
        // Signed out: the next page load deals with it.
        if (res.status === 401) return;
        if (res.ok) {
          const pulse: { connected: boolean; changeAt: string | null; now: string } = await res.json();
          if (!pulse.connected) next = IDLE_MS;
          // First answer: the page was just rendered, so only a change from the last few seconds is newer than it.
          else if (seen === undefined) due = Boolean(pulse.changeAt && Date.parse(pulse.now) - Date.parse(pulse.changeAt) < 2 * TICK_MS);
          else if (pulse.changeAt !== seen) due = true;
          seen = pulse.changeAt;
        }
      } catch {
        // Offline or a deploy in progress: try again on the next beat.
      }
      if (due && !typing() && !stopped) {
        due = false;
        router.refresh();
      }
      schedule(next);
    }
    const onVisibility = () => (document.visibilityState === "visible" ? schedule(0) : clearTimeout(timer));
    document.addEventListener("visibilitychange", onVisibility);
    schedule(TICK_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);
  return null;
}
