"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import { Overlay } from "@/components/inspections/overlay";
import { deleteVendor } from "@/app/actions/vendors";

/**
 * "Delete vendor" for owners and admins, at the foot of the edit page: for a vendor added by mistake or twice. Its
 * repairs stay with the shop name on them. A shop no longer used can be unticked instead, which keeps it on record.
 */
export function DeleteVendor({ id, name, repairs }: { id: string; name: string; repairs: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    setError(null);
    try {
      const res = await deleteVendor(id);
      if (res?.error) setError(res.error);
      else router.replace("/vendors");
    } catch {
      setError("Could not delete it. Refresh the page and try again.");
    }
  });
  return (
    <Card className="border-danger/30" title="Delete this vendor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-fg-muted">
          For a vendor added by mistake or twice. No longer using it? Untick &ldquo;Offered when picking a shop&rdquo; instead: that keeps it on record.
        </p>
        <Button variant="danger" onClick={() => { setError(null); setOpen(true); }}><Trash2 />Delete vendor</Button>
      </div>
      <Overlay variant="dialog" open={open} onClose={() => setOpen(false)} title={`Delete ${name}?`} subtitle="This can't be undone"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending} onClick={submit}><Trash2 />{pending ? "Deleting…" : "Delete vendor"}</Button>
          </div>
        }>
        <p className="text-[13px] text-fg-muted">
          {repairs
            ? <>Its <span className="text-fg">{repairs} {repairs === 1 ? "repair stays" : "repairs stay"}</span>, with the shop name on {repairs === 1 ? "it" : "them"}, but no longer linked to a vendor. Its contact, address and notes go. </>
            : <>It has no repairs. Its contact, address and notes go. </>}
          The activity log keeps a line saying who deleted it.
        </p>
        {error && <FormMessage tone="error" className="mt-3">{error}</FormMessage>}
      </Overlay>
    </Card>
  );
}
