"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Textarea, buttonClass, cn } from "@/components/ui";
import { setLoadStatus } from "@/app/actions/loads";
import type { LoadStatus } from "@/lib/constants";
import { TRANSITION_LABEL } from "../shared";

/**
 * Dispatcher status controls. Only transitions allowed by LOAD_TRANSITIONS are offered; assignment lives in the
 * Assignment card and invoicing under Financials, so ASSIGNED / INVOICED are left out here.
 */
export function StatusActions({ loadId, reference, status, transitions }: { loadId: string; reference: string; status: LoadStatus; transitions: LoadStatus[] }) {
  const [reveal, setReveal] = useState<null | "CANCELLED" | "TONU">(null);
  const action = setLoadStatus.bind(null, loadId);
  const allowed = (s: LoadStatus) => transitions.includes(s);
  const forward = allowed("IN_TRANSIT") || allowed("DELIVERED");
  const secondary = allowed("PLANNED") || allowed("CANCELLED") || allowed("TONU");

  if (!forward && !secondary) {
    return (
      <p className="text-[12px] text-fg-muted">
        {status === "INVOICED" ? "This load is invoiced — its status is final."
          : status === "PLANNED" ? "Assign a truck and driver to dispatch this load."
          : status === "DELIVERED" || status === "TONU" ? "Delivered. Invoicing is handled under Financials."
          : "No status changes are available right now."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {allowed("IN_TRANSIT") && (
        <ActionForm action={action}>
          <input type="hidden" name="status" value="IN_TRANSIT" />
          <SubmitButton className="w-full" pendingText="Departing…">{TRANSITION_LABEL.IN_TRANSIT}</SubmitButton>
          <p className="mt-1.5 text-[11px] text-fg-subtle">Marks the first pickup loaded, starts live tracking and sets the driver en route.</p>
        </ActionForm>
      )}

      {allowed("DELIVERED") && (
        <ActionForm action={action} className="space-y-2">
          <input type="hidden" name="status" value="DELIVERED" />
          <Field label="POD signed by" required><Input name="podSignedBy" required maxLength={120} placeholder="Name of the receiver" /></Field>
          <SubmitButton variant="success" className="w-full" pendingText="Confirming…">{TRANSITION_LABEL.DELIVERED}</SubmitButton>
          <p className="text-[11px] text-fg-subtle">Marks the remaining stops done, frees the trailer and moves the load to billing.</p>
        </ActionForm>
      )}

      {secondary && (
        <div className={cn("flex flex-wrap gap-2", forward && "border-t border-line pt-3")}>
          {allowed("PLANNED") && (
            <ActionForm action={action} className="min-w-28 flex-1"
              confirm={status === "ASSIGNED" ? `Unassign ${reference} and return it to Booked? The truck and driver are released.` : undefined}>
              <input type="hidden" name="status" value="PLANNED" />
              <SubmitButton variant="secondary" className="w-full" pendingText="Saving…">{status === "CANCELLED" ? "Re-open as booked" : TRANSITION_LABEL.PLANNED}</SubmitButton>
            </ActionForm>
          )}
          {allowed("TONU") && (
            <button type="button" onClick={() => setReveal(reveal === "TONU" ? null : "TONU")} aria-expanded={reveal === "TONU"}
              className={cn(buttonClass("secondary"), "min-w-28 flex-1 text-warn", reveal === "TONU" && "bg-warn-soft")}>
              TONU…
            </button>
          )}
          {allowed("CANCELLED") && (
            <button type="button" onClick={() => setReveal(reveal === "CANCELLED" ? null : "CANCELLED")} aria-expanded={reveal === "CANCELLED"}
              className={cn(buttonClass("secondary"), "min-w-28 flex-1 text-danger", reveal === "CANCELLED" && "bg-danger-soft")}>
              Cancel load…
            </button>
          )}
        </div>
      )}

      {reveal && (
        <ActionForm
          key={reveal}
          action={action}
          className="space-y-2 rounded-md border border-line bg-sunken/60 p-3"
          confirm={reveal === "CANCELLED" ? `Cancel ${reference}? The unit is released and the load leaves the board.` : `Mark ${reference} as truck ordered, not used?`}
        >
          <input type="hidden" name="status" value={reveal} />
          <Field label={reveal === "CANCELLED" ? "Reason for cancelling" : "What happened"} required>
            <Textarea name="reason" required rows={2} maxLength={300}
              placeholder={reveal === "CANCELLED" ? "Customer cancelled, no capacity, rate dispute…" : "Driver arrived, shipper had no freight…"} />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setReveal(null)}>Keep load</button>
            <SubmitButton variant={reveal === "CANCELLED" ? "danger" : "secondary"} size="sm" pendingText="Saving…">
              {reveal === "CANCELLED" ? TRANSITION_LABEL.CANCELLED : "Confirm TONU"}
            </SubmitButton>
          </div>
          <p className="text-[11px] text-fg-subtle">
            {reveal === "CANCELLED"
              ? "Cancelled loads keep their history and can be re-opened as booked later."
              : "The unit is released and the load moves to billing so a TONU fee can be invoiced."}
          </p>
        </ActionForm>
      )}
    </div>
  );
}
