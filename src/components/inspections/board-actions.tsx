"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, CheckCheck, Copy, MessageSquareText } from "lucide-react";
import { Button, Textarea, cn } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import { defectLabel } from "@/lib/service";
import { componentLabel, defectsHref } from "@/lib/pti-shared";
import { confirmTruckRepairs } from "@/app/actions/inspections";
import { Overlay } from "./overlay";

/** "Chase driver": copies a short, ready-to-send message (the dispatcher sends it from their own phone or chat). */
export function ChaseButton({ message, phone, driver }: { message: string; phone?: string | null; driver?: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this message", message);
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button size="sm" variant="secondary" onClick={copy} title={`Copies: “${message}”`}>
        {copied ? <Check /> : <MessageSquareText />}{copied ? "Copied" : "Chase driver"}
      </Button>
      {phone && (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="num text-[11px] text-fg-subtle hover:text-fg hover:underline" title={`Call ${driver ?? "the driver"}`}>{phone}</a>
      )}
    </span>
  );
}

/** A small copy-to-clipboard button for the message on its own (used in the drawer header). */
export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" variant="ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt("Copy", text); }
    }}>
      {copied ? <Check /> : <Copy />}{copied ? "Copied" : label}
    </Button>
  );
}

/**
 * Board "Confirm & clear": closes every repaired defect of the truck. Each needs an owner first, and the note is
 * required unless `noteOptional` (admins).
 */
export function ConfirmClearButton({ truckId, unitNumber, defects, holds, noteOptional }: {
  truckId: string; unitNumber: string; holds: boolean; noteOptional: boolean;
  defects: { id: string; number: number; component: string; description: string; ownerId: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const unowned = defects.filter((d) => !d.ownerId);
  const submit = () => start(async () => {
    setMsg(null);
    try {
      const res = await confirmTruckRepairs(truckId, note || null);
      if (res?.error) setMsg({ tone: "error", text: res.error });
      else { setOpen(false); setNote(""); }
    } catch {
      setMsg({ tone: "error", text: "Could not save. Refresh the page and try again." });
    }
  });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><CheckCheck />Confirm &amp; clear</Button>
      <Overlay variant="dialog" open={open} onClose={() => setOpen(false)} title={`Confirm repairs on ${unitNumber}`}
        subtitle={holds ? `${unitNumber} goes back into service once nothing else holds it.` : "Closes these defects."}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={pending || unowned.length > 0 || (!noteOptional && !note.trim())}><CheckCheck />{pending ? "Saving…" : `Confirm ${defects.length === 1 ? "and close" : `all ${defects.length}`}`}</Button>
          </div>
        }>
        <ul className="mb-3 space-y-1.5">
          {defects.map((d) => (
            <li key={d.id} className="text-[13px] text-fg">
              <span className="num font-medium">{defectLabel(d.number)}</span>
              <span className="text-fg-muted"> · {componentLabel(d.component)}</span> — {d.description}
              {!d.ownerId && <span className="text-danger"> · no owner</span>}
            </li>
          ))}
        </ul>
        {unowned.length > 0 && (
          <FormMessage tone="error" className="mb-3">
            Give {unowned.map((d) => defectLabel(d.number)).join(", ")} an owner before confirming the repair.{" "}
            <Link href={defectsHref({ unit: truckId })} className="font-medium underline underline-offset-2">Pick owners on Defects</Link>
          </FormMessage>
        )}
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-fg-muted">How you checked{noteOptional ? " (optional for admins)" : <span className="text-danger"> *</span>}</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} required={!noteOptional} placeholder="e.g. Saw the new airbag on the shop photo" />
        </label>
        {msg && <FormMessage tone={msg.tone} className={cn("mt-3")}>{msg.text}</FormMessage>}
      </Overlay>
    </>
  );
}
