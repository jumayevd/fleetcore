"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MapPin } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";
import { driverStopAction } from "@/app/actions/driver";
import { freshFix } from "./geo-store";

/**
 * Arrive (PENDING → ARRIVED) then Complete (ARRIVED → DONE) for the driver's current stop.
 * `allowComplete` is false on the final delivery, where the proof-of-delivery form takes over.
 */
export function StopActions({ loadId, stopId, status, type, allowComplete }: {
  loadId: string; stopId: string; status: string; type: string; allowComplete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const action = status === "PENDING" ? "arrive" : status === "ARRIVED" && allowComplete ? "complete" : null;
  if (!action) return null;

  const run = () => {
    setError(null);
    start(async () => {
      try {
        const r = await driverStopAction(loadId, stopId, action, freshFix());
        if (r?.error) {
          setError(r.error);
          router.refresh(); // the trip or its stops changed since this page loaded: show the current state
        }
      } catch {
        setError("Could not update the stop — check your connection and try again.");
      }
    });
  };
  const label = action === "arrive" ? "Arrive" : type === "PICKUP" ? "Complete · loaded" : "Complete · unloaded";
  const Icon = action === "arrive" ? MapPin : CheckCircle2;

  return (
    <div className="flex min-w-[9rem] flex-1 flex-col gap-1">
      <button type="button" onClick={run} disabled={pending} aria-busy={pending || undefined}
        className={cn(buttonClass("primary"), "h-11 w-full text-[14px]")}>
        <Icon />
        {pending ? "Saving…" : label}
      </button>
      {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
    </div>
  );
}
