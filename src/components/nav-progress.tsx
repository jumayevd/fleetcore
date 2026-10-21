"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Thin accent bar at the top of the window while the next page is on its way. It starts on a click on any
 * internal link and finishes when the URL changes, so it covers filters and tabs (same page, new query) as well
 * as page changes. A safety timeout clears it if a navigation never lands.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = `${pathname}?${search.toString()}`;
  // The URL we were on when the click happened; the bar runs until the URL moves on.
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    let timeout: number | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto|tel|blob|data):/i.test(href)) return;
      const next = new URL(a.href, window.location.href);
      if (next.origin !== window.location.origin || next.pathname.startsWith("/api/")) return;
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      setFrom(`${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setFrom(null), 15_000);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); window.clearTimeout(timeout); };
  }, []);

  if (from === null) return null;
  const done = from !== current;
  return (
    <div className="nav-progress" data-state={done ? "done" : "loading"} role="progressbar" aria-label="Loading page"
      onTransitionEnd={(e) => { if (done && e.propertyName === "opacity") setFrom(null); }} />
  );
}
