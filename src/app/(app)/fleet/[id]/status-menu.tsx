"use client";

import { useState } from "react";
import { ChevronDown, Store } from "lucide-react";
import { Badge, STATUS_TONE, StatusDot, buttonClass, cn } from "@/components/ui";
import { DropMenu } from "../menu";
import { truckStatusLabel, truckStatusTone } from "../lib";
import { truckStatusChoices, VendorChip } from "../status-pill";
import { useTruckStatusChange, type TruckStatusTarget } from "../truck-status-change";

/**
 * Header control: current status badge, menu of the other statuses (useTruckStatusChange: Inactive and In shop ask
 * first). In service reads Available or Assigned.
 */
export function TruckStatusMenu({ status, ...t }: TruckStatusTarget & { status: string }) {
  const [error, setError] = useState<string | null>(null);
  const change = useTruckStatusChange(t);
  const items = [
    ...truckStatusChoices(status).filter((s) => s !== status).map((s) => ({
      label: truckStatusLabel(s, t.hasDriver),
      icon: <StatusDot tone={STATUS_TONE[truckStatusTone(s, t.hasDriver)]} />,
      onSelect: () => { setError(null); change.pick(s, setError); },
    })),
    // Vendor sits beside the status: another company's or owner's truck keeps its own status.
    {
      label: t.isVendor ? "Not a vendor truck" : "Mark as vendor truck",
      icon: <Store />,
      hint: t.isVendor ? "is vendor" : undefined,
      onSelect: () => { setError(null); change.toggleVendor(setError); },
    },
  ];
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="max-w-80 truncate text-[12px] text-danger" title={error}>{error}</span>}
      <DropMenu items={items} label="Change status" className={cn(buttonClass("secondary"), "gap-2 pl-2", change.pending && "opacity-60")}>
        <Badge value={truckStatusTone(status, t.hasDriver)} label={truckStatusLabel(status, t.hasDriver)} dot />
        {t.isVendor && <VendorChip />}
        <ChevronDown className="text-fg-subtle" />
      </DropMenu>
      {change.dialogs}
    </span>
  );
}
