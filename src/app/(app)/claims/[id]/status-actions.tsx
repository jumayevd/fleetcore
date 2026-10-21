"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Field, Input, StatusDot, STATUS_TONE, Textarea, buttonClass, cn } from "@/components/ui";
import { money } from "@/lib/format";
import { moveClaimStatus } from "@/app/actions/claims";
import { DropMenu } from "../menu";
import { TRANSITION_HINT, TRANSITION_LABEL, WANTS_AMOUNT, claimStatusLabel, isClosingStatus, type ClaimStatus } from "../shared";

const DANGER: readonly ClaimStatus[] = ["DENIED", "LITIGATION"];

/** Controls Tab can land on inside the dialog. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Header status controls: the next lifecycle step as a button, the alternatives in a menu.
 * Every change confirms in a small dialog that can take the agreed / received amount and a note.
 */
export function ClaimStatusActions({ claimId, number, status, transitions, amountClaimed, amountSettled }: {
  claimId: string; number: string; status: string; transitions: ClaimStatus[]; amountClaimed: number; amountSettled: number | null;
}) {
  /** The status being confirmed, and the control that opened the dialog (focus goes back there). */
  const [pick, setPick] = useState<{ to: ClaimStatus; opener: HTMLElement | null } | null>(null);
  const [primary, ...rest] = transitions;
  if (!primary) return null;

  // Every way out (cancel, ×, Escape, the scrim, a saved change) comes through here. Focus is handed
  // back in the handler rather than an unmount effect, which dev Strict Mode would fire on open.
  const close = () => {
    const el = pick?.opener;
    setPick(null);
    if (el?.isConnected) el.focus();
  };

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <button type="button" onClick={(e) => setPick({ to: primary, opener: e.currentTarget })} className={buttonClass(DANGER.includes(primary) ? "secondary" : "primary")}>
          {TRANSITION_LABEL[primary]}
        </button>
        {rest.length > 0 && (
          <DropMenu label="Other status changes" width={240} className={cn(buttonClass("secondary"), "gap-1.5")}
            items={rest.map((s) => ({
              label: TRANSITION_LABEL[s],
              icon: <StatusDot tone={STATUS_TONE[s] ?? "neutral"} />,
              hint: claimStatusLabel(s),
              danger: DANGER.includes(s),
              // The menu item is gone once the dialog is up, so focus returns to the "More" trigger.
              onSelect: (trigger) => setPick({ to: s, opener: trigger }),
            }))}>
            More<ChevronDown className="h-3.5 w-3.5 text-fg-subtle" />
          </DropMenu>
        )}
      </div>
      {pick && (
        <StatusDialog claimId={claimId} number={number} from={status} to={pick.to} amountClaimed={amountClaimed} amountSettled={amountSettled} onClose={close} />
      )}
    </>
  );
}

/** Modal: Tab and Shift+Tab stay inside it; Escape or a click on the scrim cancels. */
function StatusDialog({ claimId, number, from, to, amountClaimed, amountSettled, onClose }: {
  claimId: string; number: string; from: string; to: ClaimStatus; amountClaimed: number; amountSettled: number | null; onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      const dialog = box.current;
      if (e.key !== "Tab" || !dialog) return;
      const els = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey ? outside || active === first : outside || active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const wantsAmount = WANTS_AMOUNT.includes(to);
  const danger = DANGER.includes(to);
  const closes = isClosingStatus(to);

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-start justify-center bg-fg/25 p-4 pt-[12vh]"
      // preventDefault keeps the click on the scrim from moving focus after it has been handed back.
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-lg border border-line bg-overlay shadow-float">
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[14px] font-semibold text-fg">{TRANSITION_LABEL[to]}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
              <span className="num">{number}</span>
              <Badge value={from} label={claimStatusLabel(from)} />
              <span className="text-fg-faint">→</span>
              <Badge value={to} label={claimStatusLabel(to)} dot />
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-raised hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </header>

        <ActionForm action={moveClaimStatus.bind(null, claimId)} onSuccess={onClose} className="space-y-3 px-4 py-3">
          <input type="hidden" name="status" value={to} />
          <p className="text-[12px] text-fg-muted">{TRANSITION_HINT[to]}</p>
          {wantsAmount && (
            <Field label={to === "PAID" ? "Amount received (USD)" : "Agreed amount (USD)"} required={to === "PAID"}
              hint={`Claimed ${money(amountClaimed)}${amountSettled != null ? ` · currently settled ${money(amountSettled)}` : ""}`}>
              <Input type="number" name="amountSettled" min={0} step={1} required={to === "PAID"} autoFocus
                defaultValue={amountSettled ?? amountClaimed} className="num" />
            </Field>
          )}
          <Field label="Note" hint="Optional. Added to the claim's notes thread with the new status.">
            <Textarea name="note" rows={2} maxLength={500} autoFocus={!wantsAmount}
              placeholder={to === "DENIED" ? "Why the insurer or counterparty denied it…" : to === "SUBMITTED" ? "Who received the pack, reference number…" : "Anything the team should know…"} />
          </Field>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-fg-subtle">{closes ? "Stamps the close date; the claim leaves the open book." : "The team on this claim is told over Telegram."}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className={buttonClass("ghost", "sm")}>Cancel</button>
              <SubmitButton variant={danger ? "danger" : "primary"} size="sm" pendingText="Saving…">{TRANSITION_LABEL[to]}</SubmitButton>
            </div>
          </div>
        </ActionForm>
      </div>
    </div>,
    document.body,
  );
}
