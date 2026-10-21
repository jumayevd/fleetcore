"use client";

import { useSyncExternalStore } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { cn } from "./ui";
import { DEFAULT_THEME, THEME_COOKIE, parseThemePref, type ThemePref } from "@/lib/theme";

const ORDER: ThemePref[] = ["light", "dark", "auto"];
const LABEL: Record<ThemePref, string> = { light: "Day", dark: "Night", auto: "Auto" };

// Tiny external store around the theme cookie so React re-renders without effects.
const listeners = new Set<() => void>();
function readPref(): ThemePref {
  const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(\\w+)`));
  return parseThemePref(m?.[1]);
}
function apply(pref: ThemePref) {
  const resolved = pref === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
  document.documentElement.setAttribute("data-theme", resolved);
}
export function writePref(pref: ThemePref) {
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
  apply(pref);
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => { if (readPref() === "auto") apply("auto"); };
  mq.addEventListener("change", onChange);
  return () => { listeners.delete(cb); mq.removeEventListener("change", onChange); };
}

/** Current Day / Night / Auto choice (from the cookie), re-rendering when it changes. */
export const useThemePref = () => useSyncExternalStore(subscribe, readPref, () => DEFAULT_THEME);

/** Day / Night / Auto. Persists in a cookie so the server renders the right theme next time. */
export function ThemeToggle({ className, showLabel }: { className?: string; showLabel?: boolean }) {
  const pref = useThemePref();
  const cycle = () => writePref(ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]);
  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : MonitorSmartphone;
  return (
    <button type="button" onClick={cycle} aria-label={`Theme: ${LABEL[pref]}. Click to change`} title={`Theme: ${LABEL[pref]}`}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-fg-muted hover:bg-raised hover:text-fg", className)}>
      <Icon className="h-4 w-4" />
      {showLabel && <span className="text-[12px]">{LABEL[pref]}</span>}
    </button>
  );
}
