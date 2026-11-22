"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/components/ui";

/**
 * The product film (public/site/tour.mp4, 1920×1080 H.264 with AAC music): FleetCore's screens recorded from the demo
 * fleet, cut to "Upbeat Corporate Technology" by Grand_Project (Pixabay, free for commercial use). Browsers only autoplay video silently, so it starts muted with a "Sound on" button.
 */
export function ProductVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);

  // React doesn't render the muted attribute, so some browsers refuse to autoplay: mute and start it here.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => setPlaying(false));
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  };
  const sound = () => {
    const v = ref.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
    if (!next) { v.currentTime = 0; void v.play(); }
  };

  return (
    <div className={cn("group relative overflow-hidden rounded-[18px] bg-[#070914] shadow-[0_40px_90px_-30px_rgba(49,46,129,0.75)] ring-1 ring-black/10 dark:ring-white/10 sm:rounded-[26px]", className)}>
      <video ref={ref} autoPlay muted loop playsInline preload="auto" poster="/site/tour-poster.jpg" width={1920} height={1080}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle}
        aria-label="FleetCore in under a minute: today's list, oil changes, repairs, walk-arounds, the live map and costs"
        className="block aspect-video h-auto w-full cursor-pointer">
        <source src="/site/tour.mp4" type="video/mp4" />
      </video>
      <div className="absolute bottom-2 right-2 flex gap-1.5 sm:bottom-5 sm:right-5 sm:gap-2">
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
