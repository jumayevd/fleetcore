"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/components/ui";

/**
 * The product film (public/site/tour.mp4, 1920×1080 H.264 with AAC music): FleetCore's screens recorded from the demo
 * fleet, cut to "Upbeat Corporate Technology" by Grand_Project (Pixabay, free for commercial use).
 *
 * Sound is on by default. Browsers only let a page play sound once the visitor has interacted with it (or, in Chrome,
 * on sites they visit often), so: try to start with sound; if the browser refuses, start silently and turn the sound
 * on at the visitor's first click, tap or key press anywhere on the page. "Sound off" is always one click away.
 */
export function ProductVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const chosen = useRef(false); // the visitor pressed Sound on/off themselves: leave it alone
  const skipToggle = useRef(false); // the click that turned the sound on shouldn't also pause the video

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const unmuteOnce = (ev: Event) => {
      // The Sound and Play buttons handle their own clicks.
      if (ev.target instanceof Element && ev.target.closest("[data-video-controls]")) return;
      events.forEach((e) => document.removeEventListener(e, unmuteOnce, true));
      if (chosen.current || !ref.current) return;
      if (ev.target === ref.current) skipToggle.current = true;
      ref.current.muted = false;
      setMuted(false);
      void ref.current.play().catch(() => {});
    };
    v.muted = false;
    v.play().then(() => setMuted(false)).catch(() => {
      // Not allowed with sound yet: play silently and wait for the first interaction.
      v.muted = true;
      setMuted(true);
      v.play().catch(() => setPlaying(false));
      events.forEach((e) => document.addEventListener(e, unmuteOnce, { capture: true, passive: true }));
    });
    return () => events.forEach((e) => document.removeEventListener(e, unmuteOnce, true));
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (skipToggle.current) { skipToggle.current = false; return; }
    if (v.paused) void v.play(); else v.pause();
  };
  const sound = () => {
    const v = ref.current;
    if (!v) return;
    chosen.current = true;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
    if (!next) void v.play();
  };

  return (
    <div className={cn("group relative overflow-hidden rounded-[18px] bg-[#070914] shadow-[0_40px_90px_-30px_rgba(49,46,129,0.75)] ring-1 ring-black/10 dark:ring-white/10 sm:rounded-[26px]", className)}>
      <video ref={ref} autoPlay muted loop playsInline preload="auto" poster="/site/tour-poster.jpg" width={1920} height={1080}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle}
        aria-label="FleetCore in under a minute: today's list, oil changes, repairs, walk-arounds, the live map and costs"
        className="block aspect-video h-auto w-full cursor-pointer">
        <source src="/site/tour.mp4" type="video/mp4" />
      </video>
      <div data-video-controls className="absolute bottom-2 right-2 flex gap-1.5 sm:bottom-5 sm:right-5 sm:gap-2">
        <button type="button" onClick={sound} aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
          className={cn("flex h-8 items-center gap-1.5 rounded-full bg-white/90 px-3 text-[12px] font-semibold sm:h-10 sm:gap-2 sm:px-4 sm:text-[13px] text-[#101828] shadow-lg backdrop-blur transition hover:bg-white",
            !muted && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}>
          {muted ? <><VolumeX className="h-4 w-4" />Sound on</> : <><Volume2 className="h-4 w-4" />Sound off</>}
        </button>
        <button type="button" onClick={toggle} aria-label={playing ? "Pause the video" : "Play the video"}
          className={cn("flex h-8 w-8 items-center justify-center rounded-full bg-white/90 sm:h-10 sm:w-10 text-[#101828] shadow-lg backdrop-blur transition hover:bg-white",
            playing ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : "opacity-100")}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
