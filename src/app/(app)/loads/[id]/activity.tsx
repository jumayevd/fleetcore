"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input, Select, StatusDot, cn } from "@/components/ui";
import { addLoadEvent } from "@/app/actions/loads";
import { EVENT_LABEL, EVENT_TABS, EVENT_TONE, type EventTab } from "../shared";

/** Pre-formatted on the server so no Date crosses the RSC boundary. */
export type ActivityEvent = { id: string; type: string; message: string; user: string | null; at: string; ago: string };

const EMPTY: Record<EventTab, string> = {
  all: "Nothing has happened on this load yet.",
  status: "No status changes yet — they appear when the load is dispatched, picked up and delivered.",
  edits: "No edits since the load was created.",
  documents: "No document activity yet. Uploads show up here.",
  billing: "No billing activity yet. The billing stage moves once the load is delivered and paperwork is on file.",
  notes: "No notes, check calls or issues yet.",
};

/**
 * Activity feed with client-side tabs (All / Status / Edits / Documents / Billing / Notes) and a form to add
 * a note, a check call or an issue (issues alert the dispatch team over Telegram).
 */
export function LoadActivity({ loadId, events, canPost }: { loadId: string; events: ActivityEvent[]; canPost: boolean }) {
  const [tab, setTab] = useState<EventTab>("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of EVENT_TABS) c[t.key] = t.types ? events.filter((e) => (t.types as readonly string[]).includes(e.type)).length : events.length;
    return c;
  }, [events]);
  const active = EVENT_TABS.find((t) => t.key === tab) ?? EVENT_TABS[0];
  const visible = active.types ? events.filter((e) => (active.types as readonly string[]).includes(e.type)) : events;

  return (
    <div>
      <div role="tablist" aria-label="Activity filter" className="flex gap-0.5 overflow-x-auto border-b border-line px-2">
        {EVENT_TABS.map((t) => {
          const selected = t.key === tab;
          return (
            <button
              key={t.key} type="button" role="tab" aria-selected={selected} onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
                selected ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
              {counts[t.key] > 0 && <span className="num rounded bg-neutral-soft px-1 text-[10px] text-fg-subtle">{counts[t.key]}</span>}
            </button>
          );
        })}
      </div>

      {canPost && (
        <ActionForm action={addLoadEvent.bind(null, loadId)} resetOnSuccess className="border-b border-line p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select name="type" aria-label="Entry type" className="sm:w-36"
              options={[{ value: "NOTE", label: "Note" }, { value: "CHECK_CALL", label: "Check call" }, { value: "ISSUE", label: "Issue" }]} />
            <Input name="message" required maxLength={500} placeholder="Add a note, log a check call or raise an issue — issues alert dispatch" aria-label="Message" />
            <SubmitButton variant="secondary" pendingText="Adding…">Add</SubmitButton>
          </div>
        </ActionForm>
      )}

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-fg-muted">{EMPTY[tab]}</p>
      ) : (
        <ol className="divide-y divide-line">
          {visible.map((e) => {
            const tone = EVENT_TONE[e.type] ?? "neutral";
            return (
              <li key={e.id} className="flex items-start gap-3 px-4 py-2 hover:bg-raised">
                <StatusDot tone={tone} className="mt-[7px]" />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[13px] text-fg", e.type === "ISSUE" && "font-medium")}>
                    {e.type === "ISSUE" && <span className="text-danger">Issue · </span>}
                    {e.type === "CHECK_CALL" && <span className="text-ok">Check call · </span>}
                    {e.message}
                  </p>
                  <p className="truncate text-[11px] text-fg-subtle">
                    {EVENT_LABEL[e.type] ?? e.type} · {e.user ?? "System"} · <span className="num">{e.at}</span> · {e.ago}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
