"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/components/ui";
import { SCENES } from "./mock/scenes";
import { MockStage } from "./mock/stage";

/**
 * The self-playing product tour: one scene per feature, moving on by itself like a video. Chapters along the top
 * jump to a feature; hovering (or the pause button) holds the current one.
 */
export function Tour({ className }: { className?: string }) {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const [hover, setHover] = useState(false);
  const scene = SCENES[i];
  const View = scene.view;
  const go = (n: number) => setI((n + SCENES.length) % SCENES.length);
  const paused = held || hover;

  return (
    <div className={cn(paused && "tour-paused", className)} onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)} onPointerLeave={() => setHover(false)}>
      <div role="tablist" aria-label="Product tour" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {SCENES.map((s, n) => (
          <button key={s.id} type="button" role="tab" aria-selected={n === i} onClick={() => setI(n)}
            className={cn("group flex min-w-[112px] flex-1 flex-col gap-2 rounded-lg px-2.5 pb-2 pt-2 text-left transition-colors", n === i ? "bg-surface shadow-card ring-1 ring-line" : "hover:bg-surface/60")}>
            <span className={cn("flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium", n === i ? "text-fg" : "text-fg-muted group-hover:text-fg")}>
              <s.icon className={cn("h-3.5 w-3.5", n === i ? "text-accent" : "text-fg-subtle")} />{s.label}
            </span>
            <span className="h-[3px] overflow-hidden rounded-full bg-line">
              {n < i && <i className="block h-full w-full rounded-full bg-accent/50" />}
              {n === i && <i key={i} className="tour-fill block h-full w-full rounded-full bg-accent" style={{ animationDuration: `${s.seconds}s` }} onAnimationEnd={() => go(i + 1)} />}
            </span>
          </button>
        ))}
      </div>

      <MockStage key={scene.id} eager>
        <View />
      </MockStage>

      <div className="mt-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-[17px] font-semibold tracking-[-0.01em]">{scene.title}</p>
          <p className="mt-1 max-w-2xl text-[14px] leading-6 text-fg-muted">{scene.text}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous feature" onClick={() => go(i - 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label={held ? "Play the tour" : "Pause the tour"} onClick={() => setHeld((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover">
            {held ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" aria-label="Next feature" onClick={() => go(i + 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-fg-muted hover:text-fg"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
