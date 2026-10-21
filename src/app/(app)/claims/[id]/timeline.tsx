import { Badge, StatusDot, type Tone } from "@/components/ui";
import { money } from "@/lib/format";
import { claimStatusLabel } from "../shared";

/** Pre-formatted on the server so no Date crosses the RSC boundary. */
export type TimelineItem = { id: string; action: string; details: string | null; user: string | null; at: string; ago: string };

const ACTION_TONE: Record<string, Tone> = { create: "ok", status: "progress", assign: "info", update: "neutral", note: "neutral", delete: "danger" };
const ACTION_LABEL: Record<string, string> = { create: "Filed", status: "Status", assign: "Assigned", update: "Edited", note: "Note", delete: "Deleted" };

/**
 * Status details look like "CLM-1001: SUBMITTED → NEGOTIATION · settled 1200 — note". The number
 * prefix and the from-status are optional: a close stamped without an audit row (seeded or imported
 * claims) arrives as "→ PAID" and renders as the new status alone.
 */
const STATUS_DETAILS = /^(?:[^:]*: )?(?:(\w+) )?→ (\w+)(.*)$/;

/** The free text after the statuses, with the settled amount shown as money. */
const statusExtra = (rest: string | undefined) =>
  rest?.replace(/^\s*[·—-]\s*/, "").replace(/^settled (\d+(?:\.\d+)?)/, (_, n: string) => `settled ${money(Number(n))}`).trim() || null;

/** Status history from the audit log (entity "claim"), oldest first. Status entries render the new status as a badge. */
export function ClaimTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p className="px-4 py-6 text-center text-[12px] text-fg-muted">Nothing has happened on this claim yet.</p>;
  return (
    <ol className="relative">
      {items.map((e, i) => {
        const tone = ACTION_TONE[e.action] ?? "neutral";
        const m = e.action === "status" ? e.details?.match(STATUS_DETAILS) : null;
        const extra = m ? statusExtra(m[3]) : null;
        const last = i === items.length - 1;
        return (
          <li key={e.id} className="relative flex items-start gap-3 px-4 py-2.5">
            {!last && <span aria-hidden className="absolute left-[21px] top-6 bottom-0 w-px bg-line" />}
            <StatusDot tone={tone} className="mt-[6px] ring-4 ring-surface" />
            <div className="min-w-0 flex-1">
              {m ? (
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-fg">
                  {m[1] ? <Badge value={m[1]} label={claimStatusLabel(m[1])} /> : <span className="text-[12px] text-fg-muted">Moved to</span>}
                  {m[1] && <span className="text-fg-faint">→</span>}
                  <Badge value={m[2]} label={claimStatusLabel(m[2])} dot />
                  {extra && <span className="text-[12px] text-fg-muted">{extra}</span>}
                </p>
              ) : (
                <p className="text-[13px] text-fg">
                  <span className={last && i === 0 ? "font-medium" : undefined}>{ACTION_LABEL[e.action] ?? e.action.replace(/_/g, " ")}</span>
                  {e.details && <span className="text-fg-muted"> · {e.details}</span>}
                </p>
              )}
              <p className="truncate text-[11px] text-fg-subtle">{e.user ?? "System"} · <span className="num">{e.at}</span> · {e.ago}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
