"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { H, W } from "./frame";

const REPLAY_MS = 9000;

/**
 * A colourful backdrop that holds one mock-up scene (a W×H canvas) scaled to its width, with motion:
 *  - it flies in, tilted in 3D, as it scrolls into view, and settles flat once it is well on screen;
 *  - it tilts towards the pointer with a soft glare;
 *  - the scene inside replays every few seconds while it is on screen, so the product always looks alive.
 * Animations inside wait until the stage is in view (data-inview). Reduced-motion users get the still scene.
 */
export function MockStage({ children, className, eager, side = "right" }: { children: ReactNode; className?: string; eager?: boolean; side?: "left" | "right" }) {
  const outer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [seen, setSeen] = useState(Boolean(eager));
  const [round, setRound] = useState(0);

  // Before paint, so a new scene never flashes at the wrong size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll-linked fly-in, pointer tilt and replays while visible.
  useEffect(() => {
    const box = outer.current, el = card.current;
    if (!box || !el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false, raf = 0, timer: ReturnType<typeof setInterval> | undefined;
    let px = 0, py = 0;
    const dir = side === "left" ? -1 : 1;

    const paint = () => {
      raf = 0;
      const r = box.getBoundingClientRect(), vh = window.innerHeight;
      // 0 when the stage's top is at the bottom of the screen, 1 once it is two-thirds of the way up.
      const p = still ? 1 : Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.62)));
      const e = 1 - (1 - p) ** 3;
      el.style.setProperty("--rx", `${(1 - e) * 24 + py * -5}deg`);
      el.style.setProperty("--ry", `${(1 - e) * 16 * dir + px * 7}deg`);
      el.style.setProperty("--ty", `${(1 - e) * 90}px`);
      el.style.setProperty("--sc", `${0.88 + 0.12 * e}`);
      el.style.setProperty("--op", `${Math.min(1, 0.15 + e * 1.1)}`);
      el.style.setProperty("--gx", `${50 + px * 40}%`);
      el.style.setProperty("--gy", `${30 + py * 40}%`);
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(paint); };
    const move = (ev: PointerEvent) => {
      if (still || ev.pointerType !== "mouse") return;
      const r = box.getBoundingClientRect();
      px = (ev.clientX - r.left) / r.width - 0.5; py = (ev.clientY - r.top) / r.height - 0.5;
      box.dataset.hover = "";
      queue();
    };
    const leave = () => { px = 0; py = 0; delete box.dataset.hover; queue(); };
    const replay = () => { if (visible && document.visibilityState === "visible") setRound((n) => n + 1); };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting && e.intersectionRatio >= 0.25;
      if (visible) {
        setSeen(true);
        if (!timer && !still) timer = setInterval(replay, REPLAY_MS);
      } else if (timer) { clearInterval(timer); timer = undefined; }
    }, { threshold: [0, 0.25] });
    io.observe(box);
    paint();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerleave", leave);
    return () => {
      io.disconnect(); if (timer) clearInterval(timer); if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", queue); window.removeEventListener("resize", queue);
      box.removeEventListener("pointermove", move); box.removeEventListener("pointerleave", leave);
    };
  }, [side]);

  return (
    <div ref={outer} className={cn("mock-tilt relative [perspective:1600px]", className)}>
      {/* A slow-turning glow behind the window. */}
      <div aria-hidden className="mock-glow pointer-events-none absolute -inset-6 rounded-[40px] opacity-60 blur-3xl dark:opacity-70" />
      <div ref={card} className="mock-card relative overflow-hidden rounded-[22px] p-[3%] sm:rounded-[28px]
        bg-[radial-gradient(55%_65%_at_12%_8%,#c7d7fe_0%,transparent_70%),radial-gradient(50%_60%_at_92%_95%,#ead5ff_0%,transparent_70%),radial-gradient(40%_45%_at_85%_10%,#bdf0ff_0%,transparent_70%),linear-gradient(160deg,#f5f8ff,#eef1fb)]
        dark:bg-[radial-gradient(55%_65%_at_12%_8%,rgba(99,102,241,0.45)_0%,transparent_70%),radial-gradient(50%_60%_at_92%_95%,rgba(168,85,247,0.38)_0%,transparent_70%),radial-gradient(40%_45%_at_85%_10%,rgba(14,165,233,0.3)_0%,transparent_70%),linear-gradient(160deg,#141a2e,#0f1322)]
        shadow-[0_50px_100px_-40px_rgba(49,46,129,0.55)] ring-1 ring-black/5 dark:ring-white/10">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(79,70,229,0.25)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(70%_70%_at_50%_50%,black,transparent)]" />
        <div ref={ref} data-inview={(seen && scale != null) || undefined} className="mock-stage relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
          <div key={round} className={cn("absolute left-0 top-0 origin-top-left transition-opacity duration-300", scale == null && "opacity-0", round > 0 && "mock-replay")}
            style={{ width: W, height: H, transform: `scale(${scale ?? 1})` }}>
            {children}
          </div>
        </div>
        <div aria-hidden className="mock-glare pointer-events-none absolute inset-0" />
      </div>
    </div>
  );
}
