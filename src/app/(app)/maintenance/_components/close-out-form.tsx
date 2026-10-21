"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, segmentedThumb, segmentedTrack } from "@/components/ui";
import { useFormat } from "@/components/locale";
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/action";
import { LinesEditor } from "@/components/shop/lines-editor";
import type { LineValue } from "@/components/shop/shared";

/**
 * Close-out: what was done (required), odometer out, when it came back and the invoice. Completing stops the
 * downtime clock, releases the unit and resets the service of that type.
 */
export function CloseOutForm({ action, lines, money, truck, odometerIn, now, needsInAt, invoice, defaultSystem, primary = true }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  lines: LineValue[];
  money: boolean;
  /** The unit is a truck (odometer out applies). */
  truck: boolean;
  odometerIn: number | null;
  /** Company time now, yyyy-MM-ddTHH:mm. */
  now: string;
  /** Never went into the shop: ask when it did. */
  needsInAt: boolean;
  invoice: { total: number | null; number: string | null; paymentStatus: string | null };
  defaultSystem: string;
  primary?: boolean;
}) {
  const f = useFormat();
  const [linesTotal, setLinesTotal] = useState(0);
  const [total, setTotal] = useState(invoice.total == null ? "" : String(invoice.total));
  const [touched, setTouched] = useState(invoice.total != null);
  const [paid, setPaid] = useState(invoice.paymentStatus ?? "");
  const shown = touched ? total : linesTotal ? String(linesTotal) : "";

  return (
    <ActionForm action={action} className="space-y-4">
      <div>
        <p className="mb-1.5 text-[12px] font-medium text-fg-muted">What was done <span className="text-danger">*</span></p>
        <LinesEditor initial={lines} money={money} defaultSystem={defaultSystem} onTotal={setLinesTotal} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {needsInAt && (
          <Field label="In the shop since" required>
            <Input type="datetime-local" name="inAt" required defaultValue={now} max={now} className="num" />
          </Field>
        )}
        <Field label="Back in service" required>
          <Input type="datetime-local" name="outAt" required defaultValue={now} max={now} className="num" />
        </Field>
        {truck && (
          <Field label={`Odometer out (${f.labels.distance})`} hint={odometerIn != null ? `In: ${f.dist(odometerIn)}` : undefined}>
            <Input type="number" name="odometerOutKm" inputMode="numeric" min={odometerIn ?? 0} defaultValue={odometerIn ?? undefined} className="num" />
          </Field>
        )}
      </div>
      {money && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice total" required hint={touched && linesTotal && Number(total) !== linesTotal ? `Lines total ${f.money2(linesTotal)}` : "0 if there was no charge"}>
            <Input name="invoiceTotal" type="number" inputMode="decimal" min={0} step="0.01" required value={shown}
              onChange={(e) => { setTotal(e.target.value); setTouched(e.target.value !== ""); }} className="num font-semibold" placeholder="0.00" />
          </Field>
          <Field label="Invoice number">
            <Input name="invoiceNumber" defaultValue={invoice.number ?? ""} className="num" />
          </Field>
          <div className="col-span-2">
            <span className="mb-1 block text-[12px] font-medium text-fg-muted">Payment</span>
            <input type="hidden" name="paymentStatus" value={paid} />
            <div className={segmentedTrack} role="radiogroup" aria-label="Payment">
              {PAYMENT_STATUSES.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={paid === p} onClick={() => setPaid(paid === p ? "" : p)} className={segmentedThumb(paid === p)}>
                  {PAYMENT_STATUS_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <SubmitButton variant={primary ? "primary" : "secondary"} className="w-full" pendingText="Completing…">Complete repair</SubmitButton>
    </ActionForm>
  );
}
