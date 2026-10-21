"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { TRUCK_STATUSES } from "@/lib/constants";
import { Badge, STATUS_TONE, StatusDot, buttonClass, cn } from "@/components/ui";
import { setTruckStatus } from "../actions";
import { DropMenu } from "../menu";
import { TRUCK_STATUS_LABELS } from "../lib";

/** Header control: current status badge, menu of the other statuses → setTruckStatus. */
export function TruckStatusMenu({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const items = TRUCK_STATUSES.filter((s) => s !== status).map((s) => ({
    label: TRUCK_STATUS_LABELS[s],
    icon: <StatusDot tone={STATUS_TONE[s]} />,
    onSelect: () => start(async () => {
      setError(null);
      try {
        const res = await setTruckStatus(id, s);
        if (res?.error) setError(res.error);
      } catch {
        setError("Could not change the status. Refresh the page and try again.");
      }
    }),
  }));
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="max-w-80 truncate text-[12px] text-danger" title={error}>{error}</span>}
      <DropMenu items={items} label="Change status" className={cn(buttonClass("secondary"), "gap-2 pl-2", pending && "opacity-60")}>
        <Badge value={status} label={TRUCK_STATUS_LABELS[status]} dot />
        <ChevronDown className="text-fg-subtle" />
      </DropMenu>
    </span>
  );
}
