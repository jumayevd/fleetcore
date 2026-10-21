"use client";

import { useState, useTransition } from "react";
import { UserRound } from "lucide-react";
import { Avatar, cn, inputClass } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { assignClaim } from "@/app/actions/claims";
import type { PersonOption } from "../shared";

/** Who owns the claim. Editors pick from the staff list; the change saves on select. The Telegram note sits in the card title. */
export function AssigneeControl({ claimId, assignedToId, assignees, editable }: {
  claimId: string; assignedToId: string | null; assignees: PersonOption[]; editable: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(undefined);
  const current = assignees.find((a) => a.id === assignedToId) ?? null;

  const onChange = (id: string) => {
    const fd = new FormData();
    fd.set("assignedToId", id);
    start(async () => {
      setState(undefined);
      try {
        setState(await assignClaim(claimId, undefined, fd));
      } catch (e) {
        setState({ error: e instanceof Error && e.message ? e.message : "Could not change the assignee" });
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {current
          ? <Avatar name={current.label} size={32} />
          : <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-fg-faint"><UserRound className="h-4 w-4" /></span>}
        <div className="min-w-0">
          <p className={cn("truncate text-[13px] font-medium", current ? "text-fg" : "text-warn")}>{current ? current.label : "Unassigned"}</p>
          {current && <p className="truncate text-[11px] text-fg-subtle">{current.hint ?? "Staff"}</p>}
        </div>
      </div>
      {editable && (
        <div>
          <select aria-label="Assign to" value={assignedToId ?? ""} disabled={pending} onChange={(e) => onChange(e.target.value)}
            className={cn(inputClass, "pr-7", pending && "opacity-60")}>
            <option value="">Unassigned</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.hint ? `${a.label} · ${a.hint}` : a.label}</option>)}
          </select>
          {state?.error && <p role="alert" className="mt-1.5 text-[11px] text-danger">{state.error}</p>}
          {state?.ok && !pending && <p role="status" className="mt-1.5 text-[11px] text-ok">{state.ok}</p>}
        </div>
      )}
    </div>
  );
}
