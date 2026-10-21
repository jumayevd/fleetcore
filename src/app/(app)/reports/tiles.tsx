import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { InfoTip, TONE_DOT, cardClass, cn, type Tone } from "@/components/ui";
import { TONE_TEXT } from "./shared";

/**
 * KPI tile for the reports page: the number, how it is worked out (behind the ⓘ), its change on the previous period,
 * a short context line (coloured only when it needs a look) and a link to where you act on it.
 */
export function ReportTile({ label, tip, value, delta, deltaTone = "neutral", note, noteTone, href, action }: {
  label: string;
  tip: ReactNode;
  value: ReactNode;
  delta?: string;
  deltaTone?: Tone;
  note?: ReactNode;
  /** Colour the context line (and make it medium weight) when it flags something. */
  noteTone?: Tone;
  href?: string;
  action?: string;
}) {
  return (
    <div className={cn(cardClass, "flex min-w-0 flex-col px-4 py-3.5")}>
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-fg-muted">
        {noteTone && noteTone !== "neutral" && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[noteTone])} aria-hidden />}
        <span className="truncate">{label}</span>
        <InfoTip>{tip}</InfoTip>
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-2">
        <p className="num truncate text-[22px] font-semibold leading-7 tracking-[-0.02em] text-fg">{value}</p>
        {delta && <span className={cn("num shrink-0 text-[11px] font-medium", TONE_TEXT[deltaTone])}>{delta}</span>}
      </div>
      {note && <p className={cn("mt-0.5 truncate text-[11px]", noteTone && noteTone !== "neutral" ? cn("font-medium", TONE_TEXT[noteTone]) : "text-fg-subtle")}>{note}</p>}
      {href && action && (
        <Link href={href} className="mt-auto inline-flex items-center gap-0.5 self-start pt-2 text-[12px] font-medium text-fg-muted hover:text-fg">
          {action}<ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** A small figure inside a card (the card is the tile): label, value, and an optional coloured note. */
export function MiniStat({ label, value, note, tone, tip }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; tip?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 truncate text-[11px] font-medium text-fg-muted">{label}{tip && <InfoTip>{tip}</InfoTip>}</p>
      <p className={cn("num mt-0.5 truncate text-[17px] font-semibold leading-6 tracking-[-0.01em]", tone && tone !== "neutral" ? TONE_TEXT[tone] : "text-fg")}>{value}</p>
      {note && <p className="truncate text-[11px] text-fg-subtle">{note}</p>}
    </div>
  );
}
