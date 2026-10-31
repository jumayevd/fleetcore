"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import { Overlay } from "@/components/inspections/overlay";
import { deleteUnit } from "./actions";

/**
 * "Delete truck / trailer" for owners and admins, at the foot of the edit page: for a unit added by mistake. Sold or
 * retired units go Inactive instead, which keeps their history. Typing the unit number confirms.
 */
export function DeleteUnit({ kind, id, unitNumber, removes }: {
  kind: "truck" | "trailer"; id: string; unitNumber: string;
  /** What goes with it, e.g. ["3 repairs", "5 documents"]; empty when nothing is recorded on it. */
  removes: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    setError(null);
    try {
      const res = await deleteUnit(kind, id, typed);
      if (res?.error) setError(res.error);
      else router.replace(kind === "truck" ? "/fleet" : "/fleet/trailers");
    } catch {
      setError("Could not delete it. Refresh the page and try again.");
    }
  });
  return (
    <Card id="delete" className="scroll-mt-20 border-danger/30" title={`Delete this ${kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-fg-muted">
          For a {kind} added by mistake. It is removed for good with everything recorded on it. Sold, stolen or returned? Set it Inactive instead: that keeps its history.
        </p>
        <Button variant="danger" onClick={() => { setTyped(""); setError(null); setOpen(true); }}><Trash2 />Delete {kind}</Button>
      </div>
      <Overlay variant="dialog" open={open} onClose={() => setOpen(false)} title={`Delete ${unitNumber}?`} subtitle="This can't be undone"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending || typed.trim() !== unitNumber} onClick={submit}><Trash2 />{pending ? "Deleting…" : `Delete ${unitNumber}`}</Button>
          </div>
        }>
        <p className="text-[13px] text-fg-muted">
          {removes.length ? <>Also removed: <span className="text-fg">{removes.join(", ")}</span>. </> : <>Nothing else is recorded on it. </>}
          The activity log keeps a line saying who deleted it.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-medium text-fg-muted">Type <span className="num text-fg">{unitNumber}</span> to confirm</span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="num" placeholder={unitNumber} />
        </label>
        {error && <FormMessage tone="error" className="mt-3">{error}</FormMessage>}
      </Overlay>
    </Card>
  );
}
