"use client";

import { useState, useTransition } from "react";
import { Check, CheckCheck, Archive, RotateCcw, Undo2 } from "lucide-react";
import { Button, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { setRoadsideStatus, setViolationCorrected } from "@/app/actions/roadside";

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) => start(async () => {
    setError(null);
    try {
      const res = await fn();
      if (res?.error) setError(res.error);
    } catch {
      setError("Could not save. Refresh the page and try again.");
    }
  });
  return { pending, error, run };
}

/** "Mark corrected" on one violation (or undo it). */
export function ViolationToggle({ id, corrected, disabled }: { id: string; corrected: boolean; disabled?: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1.5">
      {corrected ? (
        <Button size="sm" variant="ghost" disabled={pending || disabled} onClick={() => run(() => setViolationCorrected(id, false))} title="Mark not corrected">
          <Undo2 />Undo
        </Button>
      ) : (
        <Button size="sm" variant="secondary" disabled={pending || disabled} onClick={() => run(() => setViolationCorrected(id, true))}>
          <Check />{pending ? "Saving…" : "Mark corrected"}
        </Button>
      )}
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}

/** Header buttons: correct everything, close (file) the inspection, or reopen it. */
export function RoadsideStatusButtons({ id, status, uncorrected }: { id: string; status: string; uncorrected: number }) {
  const { pending, error, run } = useRun();
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      {error && <span role="alert" className="max-w-80 truncate text-[12px] text-danger" title={error}>{error}</span>}
      {status === "OPEN" && uncorrected > 0 && (
        <Button disabled={pending} onClick={() => run(() => setRoadsideStatus(id, "CORRECTED"))} title="Ticks every violation still open as corrected">
          <CheckCheck />Mark all corrected
        </Button>
      )}
      {status !== "CLOSED" && (
        <Button variant={status === "CORRECTED" || uncorrected === 0 ? "primary" : "secondary"} disabled={pending}
          onClick={() => {
            if (uncorrected > 0 && !window.confirm(`${uncorrected} violation${uncorrected === 1 ? " is" : "s are"} not marked corrected. Close the inspection anyway?`)) return;
            run(() => setRoadsideStatus(id, "CLOSED"));
          }}>
          <Archive />Close
        </Button>
      )}
      {status !== "OPEN" && (
        <Button variant="secondary" disabled={pending} onClick={() => run(() => setRoadsideStatus(id, "OPEN"))}><RotateCcw />Reopen</Button>
      )}
    </span>
  );
}
