"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { H, W } from "./frame";

/**
 * A colourful backdrop that holds one mock-up scene (a W×H canvas) scaled to its width. Animations inside wait until
 * the stage scrolls into view (data-inview), so a scene further down the page plays when it's seen, not at load.
 */
export function MockStage({ children, className, eager }: { children: ReactNode; className?: string; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [seen, setSeen] = useState(Boolean(eager));

  // Before paint, so a new scene never flashes at the wrong size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);

  return (
    <div className={cn("relative overflow-hidden rounded-[22px] p-[3%] sm:rounded-[28px]",
      "bg-[radial-gradient(55%_65%_at_12%_8%,#c7d7fe_0%,transparent_70%),radial-gradient(50%_60%_at_92%_95%,#ead5ff_0%,transparent_70%),radial-gradient(40%_45%_at_85%_10%,#bdf0ff_0%,transparent_70%),linear-gradient(160deg,#f5f8ff,#eef1fb)]",
      "dark:bg-[radial-gradient(55%_65%_at_12%_8%,rgba(99,102,241,0.45)_0%,transparent_70%),radial-gradient(50%_60%_at_92%_95%,rgba(168,85,247,0.38)_0%,transparent_70%),radial-gradient(40%_45%_at_85%_10%,rgba(14,165,233,0.3)_0%,transparent_70%),linear-gradient(160deg,#141a2e,#0f1322)]",
      "ring-1 ring-black/5 dark:ring-white/10", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(79,70,229,0.25)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(70%_70%_at_50%_50%,black,transparent)]" />
      <div ref={ref} data-inview={(seen && scale != null) || undefined} className="mock-stage relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <div className={cn("absolute left-0 top-0 origin-top-left transition-opacity duration-300", scale == null && "opacity-0")}
          style={{ width: W, height: H, transform: `scale(${scale ?? 1})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
