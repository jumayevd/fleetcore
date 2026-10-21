"use client";

import { useEffect, useState } from "react";
import { Navigation, NavigationOff, Satellite } from "lucide-react";
import { InfoTip, LiveDot, buttonClass, cn } from "@/components/ui";
import { clearFix, setFix } from "./geo-store";

const SEND_EVERY_MS = 20_000;

type State = { mode: "off" | "waiting" | "live" | "error"; text: string };
const OFF: State = { mode: "off", text: "Not sharing — dispatch sees the last known position" };

/** Shares the phone's GPS with dispatch (POST /api/telemetry/ping) while this page is open. */
export function GpsShare({ unitNumber }: { unitNumber: string }) {
  const [on, setOn] = useState(false);
  const [state, setState] = useState<State>(OFF);

  useEffect(() => {
    if (!on) return;
    let lastSent = 0;
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, speed, heading } = pos.coords;
        setFix({ lat, lng, at: Date.now() });
        if (Date.now() - lastSent < SEND_EVERY_MS) return;
        lastSent = Date.now();
        const speedKmh = speed != null && speed >= 0 ? speed * 3.6 : undefined;
        const body = { lat, lng, speedKmh, heading: heading != null && !Number.isNaN(heading) ? heading : undefined };
        const r = await fetch("/api/telemetry/ping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
        const data = r ? await r.json().catch(() => ({})) : {};
        if (r?.ok) {
          const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setState({ mode: "live", text: `Live · sent ${at}${speedKmh != null ? ` · ${Math.round(speedKmh)} km/h` : ""}` });
        } else {
          setState({ mode: "error", text: `Could not send: ${data.error ?? "you appear to be offline"}` });
        }
      },
      (err) => setState({
        mode: "error",
        text: err.code === err.PERMISSION_DENIED ? "Location permission denied — allow it in the browser settings" : "No GPS signal right now, still trying",
      }),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      clearFix();
    };
  }, [on]);

  const start = () => {
    if (!("geolocation" in navigator)) {
      setState({ mode: "error", text: "This device has no location service" });
      return;
    }
    setState({ mode: "waiting", text: "Waiting for a GPS fix…" });
    setOn(true);
  };
  const stop = () => {
    setOn(false);
    setState(OFF);
  };

  return (
    <section aria-label="Live location" className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", state.mode === "live" ? "bg-accent-soft text-accent-text" : "bg-sunken text-fg-subtle")}>
          <Satellite className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-fg">Live location</p>
            <InfoTip>Sends {unitNumber}&apos;s position every 20 s while this page is open. Dispatch and the live map use it instead of the estimated route.</InfoTip>
            {state.mode === "live" && <LiveDot />}
          </div>
          <p className={cn("line-clamp-2 text-[12px] leading-4", state.mode === "error" ? "text-danger" : "text-fg-muted")} role="status">{state.text}</p>
        </div>
        <button type="button" onClick={on ? stop : start} aria-pressed={on}
          className={cn(buttonClass(on ? "secondary" : "primary"), "h-11 min-w-[6.5rem] px-4 text-[14px]")}>
          {on ? <><NavigationOff />Stop</> : <><Navigation />Share</>}
        </button>
      </div>
    </section>
  );
}
