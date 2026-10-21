"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { REPAIR_STAGES, REPAIR_STAGE_LABELS } from "@/lib/constants";
import { Button, cn, inputClass } from "@/components/ui";
import { setRepairStage } from "@/app/actions/repairs";

/**
 * Where a job in the shop has got to. Tap a stage to move it there, with an optional note (it goes on the stage
 * history). Read-only when the repair is not in the shop or the person can't edit.
 */
export function StagePipeline({ id, stage, editable, finished }: {
  id: string;
  stage: string | null;
  /** In the shop and the person can edit. */
  editable: boolean;
  /** Completed: every stage shows as passed. */
  finished?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const current = finished ? REPAIR_STAGES.length : stage ? REPAIR_STAGES.indexOf(stage as (typeof REPAIR_STAGES)[number]) : -1;

  const save = () =>
    start(async () => {
      if (!picked) return;
      setError(null);
      try {
        const res = await setRepairStage(id, picked, note);
        if (res?.error) setError(res.error);
        else { setPicked(null); setNote(""); }
      } catch {
        setError("Could not move the stage. Refresh the page and try again.");
      }
    });

  return (
    <div>
      <ol className="grid gap-1.5 sm:grid-cols-3 xl:grid-cols-6" aria-label="Repair stages">
        {REPAIR_STAGES.map((s, i) => {
          const passed = i < current;
          const here = i === current;
          const content = (
            <>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                passed ? "bg-ok-soft text-ok" : here ? "bg-accent text-on-accent" : "border border-line-strong text-fg-subtle")}>
                {passed ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span className={cn("min-w-0 text-left text-[12px] leading-4", here ? "font-semibold text-fg" : passed ? "text-fg-muted" : "text-fg-subtle")}>{REPAIR_STAGE_LABELS[s]}</span>
            </>
          );
          const cls = cn("flex w-full items-center gap-2 rounded-[9px] border px-2.5 py-2",
            here ? "border-accent bg-accent-soft" : picked === s ? "border-line-strong bg-raised" : "border-line",
            editable && "transition-colors hover:border-line-strong hover:bg-raised");
          return (
            <li key={s} aria-current={here ? "step" : undefined}>
              {editable
                ? <button type="button" className={cls} onClick={() => { setPicked(picked === s ? null : s); setError(null); }} aria-pressed={picked === s}>{content}</button>
                : <div className={cls}>{content}</div>}
            </li>
          );
        })}
      </ol>
      {editable && picked && (
        <div className="fade-in mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setPicked(null); }}
            placeholder={picked === stage ? "What changed? (required to log an update)" : "Note for the stage history (optional)"}
            aria-label="Stage note" className={cn(inputClass, "flex-1")} autoFocus />
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending || (picked === stage && !note.trim())} onClick={save}>
              {pending ? "Saving…" : picked === stage ? "Log update" : `Move to ${REPAIR_STAGE_LABELS[picked].toLowerCase()}`}
            </Button>
            <Button variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
