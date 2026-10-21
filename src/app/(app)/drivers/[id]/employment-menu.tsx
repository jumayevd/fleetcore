"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { setDriverEmployment } from "@/app/actions/people";
import { DRIVER_STATUSES } from "@/lib/constants";
import { Badge, STATUS_TONE, StatusDot, buttonClass, cn } from "@/components/ui";
import { DropMenu } from "../menu";
import { EMPLOYMENT_LABELS } from "../shared";

const HINT: Record<string, string> = { ACTIVE: "back on the board", ON_LEAVE: "board shows Vacation", INACTIVE: "leaves the roster" };

/** Header control: current employment status, menu of the others → setDriverEmployment. */
export function EmploymentMenu({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const items = DRIVER_STATUSES.filter((s) => s !== status).map((s) => ({
    label: EMPLOYMENT_LABELS[s],
    hint: HINT[s],
    icon: <StatusDot tone={STATUS_TONE[s] ?? "neutral"} />,
    onSelect: () => start(async () => {
      setError(null);
      try {
        const res = await setDriverEmployment(id, s);
        if (res?.error) setError(res.error);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        setError(msg && !/server components|digest/i.test(msg) ? msg : "Could not change status — the driver may still be on a load");
      }
    }),
  }));
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="max-w-72 truncate text-[11px] text-danger" title={error}>{error}</span>}
      <DropMenu items={items} label="Change employment status" width={232} className={cn(buttonClass("secondary"), "gap-2 pl-2", pending && "opacity-60")}>
        <Badge value={status} label={EMPLOYMENT_LABELS[status] ?? status} dot />
        <ChevronDown className="text-fg-subtle" />
      </DropMenu>
    </span>
  );
}
