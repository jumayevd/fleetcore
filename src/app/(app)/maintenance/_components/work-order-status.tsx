"use client";

import { useState, useTransition } from "react";
import { Check, Play, X } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { moveWorkOrder } from "../_lib/actions";

/**
 * Status buttons for a work order row or header.
 * Draft / open → Start (in progress). In progress → Complete (done). Anything not finished → Cancel.
 * The server action applies the side effects (unit into / out of the shop, PM interval reset); cancelling a job
 * in progress releases the unit too. It re-checks the work order first, so a stale page cannot move a job someone
 * else already started or finished.
 */
export function WorkOrderStatusButtons({ id, status, number, size = "sm", compact, className }: {
  id: string;
  status: string;
  /** Shown in the cancel confirmation. */
  number?: number;
  size?: "sm" | "md";
  /** Icon-only cancel (for dense table rows). */
  compact?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (status === "DONE" || status === "CANCELLED") return null;

  const go = (to: string) =>
    start(async () => {
      setError(null);
      try {
        const res = await moveWorkOrder(id, to);
        if (res?.error) setError(res.error);
      } catch {
        setError("Could not update the work order. Refresh the page and try again.");
      }
    });

  const inProgress = status === "IN_PROGRESS";
  const Icon = inProgress ? Check : Play;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Button size={size} variant={inProgress ? "success" : "secondary"} disabled={pending} onClick={() => go(inProgress ? "DONE" : "IN_PROGRESS")}
        title={inProgress ? "Mark done and release the unit" : "Start work and put the unit in the shop"}>
        <Icon />{pending ? "Saving…" : inProgress ? "Complete" : "Start"}
      </Button>
      <Button size={size} variant="ghost" disabled={pending} aria-label="Cancel work order" title="Cancel work order"
        onClick={() => {
          if (window.confirm(`Cancel work order${number ? ` #${number}` : ""}? If the unit is in the shop it is released; the record is kept for history.`)) go("CANCELLED");
        }}>
        <X />{!compact && "Cancel"}
      </Button>
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
