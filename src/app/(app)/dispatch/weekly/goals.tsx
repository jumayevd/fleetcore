"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { Button, Field, Input, cn } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { money } from "@/lib/format";
import { setWeeklyGoals } from "@/app/actions/board";

/** Weekly goals chip; opens an edit popover for users who can manage settings. */
export function GoalsControl({ goals, canManage }: { goals: { solo: number; team: number }; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const summary = <><Target /><span className="text-fg-muted">Goals</span><span className="num">{money(goals.solo)}</span><span className="text-fg-subtle">solo ·</span><span className="num">{money(goals.team)}</span><span className="text-fg-subtle">team</span></>;

  if (!canManage) {
    return <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12px] text-fg [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-fg-subtle" title="Weekly revenue goals per driver">{summary}</span>;
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Edit weekly goals" className={cn(open && "border-line-strong")}>{summary}</Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-line bg-overlay p-3 shadow-float">
          <p className="text-[13px] font-semibold text-fg">Weekly revenue goals</p>
          <p className="mb-3 mt-0.5 text-[11px] text-fg-subtle">Per driver, per week. Solo applies to company drivers; team to owner-operators and lease-operators. Efficiency and plan Δ are measured against these.</p>
          <ActionForm action={setWeeklyGoals} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Solo goal ($)"><Input name="solo" type="number" min={0} step={100} defaultValue={goals.solo} required className="num" /></Field>
              <Field label="Team goal ($)"><Input name="team" type="number" min={0} step={100} defaultValue={goals.team} required className="num" /></Field>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <SubmitButton size="sm">Save goals</SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
