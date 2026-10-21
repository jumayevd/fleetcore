"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Opens the Recover panel when someone lands on (or jumps to) `#recover` — e.g. the row menu's "Recover to another unit". */
export function openRecoverPanel() {
  const d = document.getElementById("recover");
  if (d instanceof HTMLDetailsElement) d.open = true;
}

/** The collapsible Recover section: closed until needed; the URL hash (#recover, from the row menu) opens it. */
export function RecoverDetails({ defaultOpen, summary, children }: { defaultOpen: boolean; summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== "#recover" || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  return (
    <details ref={ref} id="recover" open={defaultOpen} className="group mt-4 scroll-mt-16 border-t border-line pt-3">
      <summary className="eyebrow cursor-pointer list-none select-none marker:content-none [&::-webkit-details-marker]:hidden">{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
