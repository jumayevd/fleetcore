"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import { Overlay } from "@/components/inspections/overlay";
import { deleteDriver } from "@/app/actions/drivers";

/**
 * "Delete driver" for owners and admins, at the foot of the edit page: for a driver added by mistake. Drivers who left
 * go Inactive instead, which keeps their history. Typing the driver's name confirms.
 */
export function DeleteDriver({ id, name, removes }: {
  id: string; name: string;
  /** What goes with them, e.g. ["4 documents", "2 truck stints"]; empty when nothing is recorded. */
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
      const res = await deleteDriver(id, typed);
      if (res?.error) setError(res.error);
      else router.replace("/drivers");
    } catch {
      setError("Could not delete the driver. Refresh the page and try again.");
    }
  });
  return (
    <Card id="delete" className="scroll-mt-20 border-danger/30" title="Delete this driver">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-fg-muted">
          For a driver added by mistake. They are removed for good with their files and truck history. Left the company? Set them Inactive instead: that keeps their history.
        </p>
        <Button variant="danger" onClick={() => { setTyped(""); setError(null); setOpen(true); }}><Trash2 />Delete driver</Button>
      </div>
      <Overlay variant="dialog" open={open} onClose={() => setOpen(false)} title={`Delete ${name}?`} subtitle="This can't be undone"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending || typed.trim() !== name.trim()} onClick={submit}><Trash2 />{pending ? "Deleting…" : "Delete driver"}</Button>
          </div>
        }>
        <p className="text-[13px] text-fg-muted">
          {removes.length ? <>Also removed: <span className="text-fg">{removes.join(", ")}</span>. </> : <>Nothing else is recorded for them. </>}
          Fuel logs, walk-arounds and repairs stay, without the driver&apos;s name. The activity log keeps a line saying who deleted them.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-medium text-fg-muted">Type <span className="text-fg">{name}</span> to confirm</span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus placeholder={name} />
        </label>
        {error && <FormMessage tone="error" className="mt-3">{error}</FormMessage>}
      </Overlay>
    </Card>
  );
}
