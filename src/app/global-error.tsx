"use client";

import "./globals.css";
import { useSyncExternalStore, type CSSProperties } from "react";
import { DEFAULT_THEME, THEME_COOKIE } from "@/lib/theme";
import RootError from "./error";

// Replaces the root layout, so nothing from it applies: no data-theme, no Geist font variables.
// System stacks stand in for Geist; the theme is resolved like the layout's boot script does.
const FONT_FALLBACK = { "--font-inter": "ui-sans-serif", "--font-geist-sans": "ui-sans-serif", "--font-geist-mono": "ui-monospace" } as CSSProperties;
const subscribe = () => () => {};
function readTheme(): "light" | "dark" {
  try {
    const pref = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(light|dark|auto)`))?.[1] ?? DEFAULT_THEME;
    if (pref === "auto") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    return pref === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Last-resort boundary for failures in the root layout itself. Same card as app/error.tsx. */
export default function GlobalError(props: Parameters<typeof RootError>[0]) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => undefined);
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <body className="font-sans antialiased" style={FONT_FALLBACK}>
        <RootError {...props} />
      </body>
    </html>
  );
}
