"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCheck, Video, VideoOff } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Chip, Field, Input, Textarea, TONE_SOFT, buttonClass, cn, type Tone } from "@/components/ui";
import { PTI_COMPONENTS, PTI_RATINGS, PTI_RATING_LABELS } from "@/lib/constants";
import { defectLabel } from "@/lib/service";
import {
  RATING_HINTS, RATING_SEVERITY, RATING_TONE, SEVERITY_SHORT, SEVERITY_TONE, VERDICTS, VERDICT_HINTS, VERDICT_LABELS, VERDICT_TONE,
  componentLabel, plural, type Verdict,
} from "@/lib/pti-shared";
import { saveWalkAroundReview } from "@/app/actions/inspections";

export type ReviewEarlierDefect = {
  id: string; number: number; component: string; description: string; severity: string; status: string;
  holdsUnit: boolean; daysOpen: number; repair: string | null;
};
export type ReviewHistoryWeek = {
  key: string; label: string; current: boolean;
  video: string | null; result: string | null; reviewer: string | null; reviewedOn: string | null;
  /** Marks by kind and how many components were marked at all. */
  soon: number; now: number; unseen: number; total: number; found: number;
};
export type ReviewFormProps = {
  truckId: string; unitNumber: string;
  week: string; weekLabel: string;
  /** Board filter to return to. */
  show?: string;
  video: string;
  receivedLabel: string | null;
  reviewed: { by: string | null; on: string; stamp: string } | null;
  notes: string;
  ratings: Record<string, string>;
  /** Defects this walk-around already raised (a second save updates them instead of adding new ones). */
  thisWeek: Record<string, { number: number; description: string; severity: string }>;
  earlier: ReviewEarlierDefect[];
  history: ReviewHistoryWeek[];
  next: { truckId: string; unitNumber: string } | null;
  closeHref: string;
};

type Opt = { value: string; label: string; tone: Tone; hint?: string };

/** A row of radio pills: the choice reads as a tinted tile in its tone. */
function RadioPills({ name, value, onChange, options, label, size = "md" }: {
  name: string; value: string; onChange: (v: string) => void; options: Opt[]; label: string; size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full shrink-0 flex-wrap items-center gap-0.5 rounded-[10px] bg-sunken p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label key={o.value} title={o.hint}
            className={cn("inline-flex cursor-pointer items-center rounded-[7px] font-medium transition-[color,background-color,box-shadow] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
              size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12px]",
              on ? cn(o.tone === "neutral" ? "bg-surface text-fg" : TONE_SOFT[o.tone], "shadow-card") : "text-fg-muted hover:text-fg")}>
            <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

const RATING_OPTIONS: Opt[] = PTI_RATINGS.map((r) => ({ value: r, label: PTI_RATING_LABELS[r] ?? r, tone: RATING_TONE[r], hint: RATING_HINTS[r] }));
const VERDICT_OPTIONS: Opt[] = VERDICTS.map((v) => ({ value: v, label: VERDICT_LABELS[v], tone: VERDICT_TONE[v], hint: VERDICT_HINTS[v] }));

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ReviewForm(p: ReviewFormProps) {
  const [video, setVideo] = useState(p.video === "MISSING" ? "MISSING" : "RECEIVED");
  const [ratings, setRatings] = useState<Record<string, string>>(() =>
    Object.fromEntries(PTI_COMPONENTS.map((c) => [c, p.ratings[c] ?? "GOOD"])));
  const [descs, setDescs] = useState<Record<string, string>>(() =>
    Object.fromEntries(PTI_COMPONENTS.map((c) => [c, p.thisWeek[c]?.description ?? ""])));
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(() => Object.fromEntries(p.earlier.map((d) => [d.id, "UNSEEN" as Verdict])));
  const after = useRef<HTMLInputElement>(null);

  const counts = PTI_RATINGS.map((r) => [r, PTI_COMPONENTS.filter((c) => ratings[c] === r).length] as const).filter(([, n]) => n > 0);
  /** Earlier defects still open for a component once the verdicts are applied: rating it again keeps that one open. */
  const trackedFor = (c: string) => p.earlier.find((d) => d.component === c && verdicts[d.id] !== "FIXED");
  const allGood = PTI_COMPONENTS.every((c) => ratings[c] === "GOOD");
  const newNow = PTI_COMPONENTS.some((c) => ratings[c] === "NOW");

  return (
    <ActionForm action={saveWalkAroundReview} className="space-y-6">
      <input type="hidden" name="truckId" value={p.truckId} />
      <input type="hidden" name="week" value={p.week} />
      {p.show && <input type="hidden" name="show" value={p.show} />}
      {p.next && <input type="hidden" name="nextTruck" value={p.next.truckId} />}
      <input type="hidden" name="reviewedStamp" value={p.reviewed?.stamp ?? ""} />
      <input ref={after} type="hidden" name="after" defaultValue="close" />

      {p.reviewed && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-[12px] text-info">
          Reviewed {p.reviewed.on}{p.reviewed.by ? ` by ${p.reviewed.by}` : ""}. Saving again replaces this week&apos;s ratings; defects it raised are updated, not duplicated.
        </p>
      )}

      <Section title="Video">
        <div className="flex flex-wrap items-center gap-3">
          <RadioPills name="video" label="Video" value={video} onChange={setVideo} options={[
            { value: "RECEIVED", label: "Received", tone: "ok" },
            { value: "MISSING", label: "Missing", tone: "warn" },
          ]} />
          <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle">
            {video === "RECEIVED" ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            {video === "RECEIVED" ? (p.receivedLabel ? `In since ${p.receivedLabel}` : "Recorded as received now") : "Nothing else is saved until the video comes in"}
          </span>
        </div>
        {video === "MISSING" && p.reviewed && (
          <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">
            This withdraws the review of {p.reviewed.on}
            {Object.keys(p.thisWeek).length ? ` and closes ${Object.values(p.thisWeek).map((d) => defectLabel(d.number)).join(", ")}, which it raised` : ""}.
            {" "}The marks are kept: switch back to Received and save to restore it.
          </p>
        )}
      </Section>

      {video === "RECEIVED" && p.earlier.length > 0 && (
        <Section title={`Earlier issues · ${p.earlier.length}`} aside={<span className="text-[11px] text-fg-subtle">Only &ldquo;Fixed&rdquo; closes a defect</span>}>
          <ul className="divide-y divide-line rounded-md border border-line">
            {p.earlier.map((d) => (
              <li key={d.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] text-fg">
                      <span className="num font-medium">{defectLabel(d.number)}</span>
                      <span className="text-fg-muted"> · {componentLabel(d.component)}</span>
                      <span> — {d.description}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                      <Chip tone={SEVERITY_TONE[d.severity] ?? "neutral"}>{SEVERITY_SHORT[d.severity] ?? d.severity}</Chip>
                      {d.holdsUnit && <Chip tone="danger">Holding the truck</Chip>}
                      <span>open {plural(d.daysOpen, "day")}</span>
                      {d.status === "REPAIRED" && <span className="text-info">repaired · not yet confirmed</span>}
                      {d.repair && <span>· {d.repair}</span>}
                    </p>
                  </div>
                  <RadioPills name={`verdict_${d.id}`} label={`What you saw for ${defectLabel(d.number)}`} size="sm" value={verdicts[d.id]}
                    onChange={(v) => setVerdicts((s) => ({ ...s, [d.id]: v as Verdict }))} options={VERDICT_OPTIONS} />
                </div>
                {verdicts[d.id] === "FIXED" && (
                  <Input name={`fixNote_${d.id}`} placeholder="How you can tell (optional), e.g. new tire visible at 0:42" aria-label={`Note for ${defectLabel(d.number)}`} />
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {video === "RECEIVED" && (
        <Section title="What the video shows" aside={
          <span className="flex items-center gap-2">
            <span className="hidden text-[11px] text-fg-subtle sm:inline">{counts.map(([r, n]) => `${n} ${(PTI_RATING_LABELS[r] ?? r).toLowerCase()}`).join(" · ")}</span>
            <button type="button" disabled={allGood} onClick={() => setRatings(Object.fromEntries(PTI_COMPONENTS.map((c) => [c, "GOOD"])))}
              className={buttonClass("secondary", "sm")}><CheckCheck />Mark all good</button>
          </span>
        }>
          <ul className="divide-y divide-line rounded-md border border-line">
            {PTI_COMPONENTS.map((c) => {
              const r = ratings[c];
              const bad = Boolean(RATING_SEVERITY[r]);
              const own = p.thisWeek[c];
              const tracked = trackedFor(c);
              return (
                <li key={c} className={cn("px-3 py-2", r === "NOW" ? "bg-danger-soft/60" : r === "SOON" ? "bg-warn-soft/60" : undefined)}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg">
                      {componentLabel(c)}
                      {tracked && <Chip tone={SEVERITY_TONE[tracked.severity] ?? "neutral"} title={tracked.description}>{defectLabel(tracked.number)} open</Chip>}
                      {own && !tracked && <Chip tone="neutral" title={own.description}>{defectLabel(own.number)}</Chip>}
                    </span>
                    <RadioPills name={`rating_${c}`} label={componentLabel(c)} size="sm" value={r} onChange={(v) => setRatings((s) => ({ ...s, [c]: v }))} options={RATING_OPTIONS} />
                  </div>
                  {bad && (
                    <Input name={`desc_${c}`} value={descs[c]} onChange={(e) => setDescs((s) => ({ ...s, [c]: e.target.value }))}
                      required={!own && !tracked} aria-label={`What is wrong with the ${componentLabel(c).toLowerCase()}`}
                      placeholder={tracked ? `Already tracked as ${defectLabel(tracked.number)}; add a note only if it changed` : "What you saw, e.g. cut on the sidewall, cords showing"}
                      className="mt-2" />
                  )}
                </li>
              );
            })}
          </ul>
          {newNow && (
            <p className="mt-2 text-[12px] text-danger">A Now rating takes {p.unitNumber} out of service until someone confirms the repair.</p>
          )}
        </Section>
      )}

      <Field label="Notes" hint={video === "MISSING" ? "Why it's missing, who was asked to send it." : "Anything the shop or the next reviewer should know."}>
        <Textarea name="notes" rows={2} defaultValue={p.notes} />
      </Field>

      {p.history.length > 0 && (
        <Section title="Last 4 weeks">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {p.history.map((h) => {
              // Same words as the board's counters: all good is clean, all not seen is nothing seen.
              const received = h.video === "RECEIVED";
              const reviewed = received && Boolean(h.result) && h.total > 0;
              const label = !received ? (h.video === "MISSING" ? "Missing" : "Nothing sent")
                : !reviewed ? "Not reviewed"
                  : h.unseen === h.total ? "Nothing seen"
                    : h.soon + h.now > 0 ? (h.unseen ? "Issues · to review" : "Issues")
                      : h.unseen ? "To review"
                        : "Clean";
              const tone: Tone = !received || label === "Nothing seen" ? "neutral" : !reviewed || label === "To review" ? "progress" : label === "Clean" ? "ok" : "warn";
              return (
                <li key={h.key} className={cn("rounded-md border px-2.5 py-2", h.current ? "border-accent/50 bg-accent-soft/40" : "border-line")}>
                  <p className="num text-[11px] text-fg-subtle">Week of {h.label}</p>
                  <p className={cn("mt-0.5 text-[12px] font-medium", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "progress" ? "text-progress" : "text-fg-muted")}>
                    {label}
                  </p>
                  <p className="truncate text-[11px] text-fg-subtle" title={h.reviewer ?? undefined}>
                    {reviewed
                      ? [h.now ? `${h.now} now` : null, h.soon ? `${h.soon} soon` : null, h.unseen ? `${h.unseen} not seen` : null].filter(Boolean).join(" · ") || (h.reviewer ? `by ${h.reviewer}` : "all good")
                      : "—"}
                  </p>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      <div className="sticky bottom-0 -mx-5 -mb-4 flex flex-wrap items-center gap-2 border-t border-line bg-overlay px-5 py-3">
        <span onClickCapture={() => { if (after.current) after.current.value = "close"; }}>
          <SubmitButton>{video === "MISSING" ? "Mark video missing" : p.reviewed ? "Save changes" : "Save review"}</SubmitButton>
        </span>
        {p.next && (
          <span onClickCapture={() => { if (after.current) after.current.value = "next"; }}>
            <SubmitButton variant="secondary" pendingText="Saving…">Save and review {p.next.unitNumber}</SubmitButton>
          </span>
        )}
        <Link href={p.closeHref} scroll={false} className={buttonClass("ghost")}>Cancel</Link>
      </div>
    </ActionForm>
  );
}
