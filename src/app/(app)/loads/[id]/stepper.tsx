import { Check } from "lucide-react";
import { dateTime } from "@/lib/format";
import { Badge, cn } from "@/components/ui";
import type { LoadStep, Terminal } from "../shared";

/**
 * Booked → Dispatched → At pickup → In transit → Delivered → Invoiced with the time each milestone
 * was reached. Cancelled / TONU loads keep the milestones they hit and end in a terminal strip.
 */
export function LoadStepper({ steps, terminal, className }: { steps: LoadStep[]; terminal: Terminal; className?: string }) {
  return (
    <section aria-label="Load progress" className={cn("rounded-lg border border-line bg-surface", className)}>
      <ol className="grid grid-cols-3 gap-y-3 px-4 py-3 sm:grid-cols-6">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const done = s.state === "done";
          const current = s.state === "current";
          return (
            <li key={s.key} className="min-w-0" aria-current={current ? "step" : undefined}>
              <div className="flex items-center">
                <span
                  className={cn(
                    "num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    done && "border-ok bg-ok text-surface",
                    current && "border-accent bg-accent text-on-accent ring-4 ring-accent/20",
                    s.state === "todo" && "border-line-strong text-fg-faint",
                    s.state === "skipped" && "border-dashed border-line text-fg-faint",
                  )}
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                </span>
                {!last && <span className={cn("mx-2 h-px flex-1", done ? "bg-ok/50" : "bg-line")} aria-hidden />}
              </div>
              <p className={cn("mt-1.5 truncate text-[12px] font-medium", done || current ? "text-fg" : "text-fg-faint")}>{s.label}</p>
              <p className={cn("num truncate text-[11px]", s.at ? "text-fg-subtle" : "text-fg-faint")}>
                {s.at ? dateTime(s.at) : current ? "now" : s.state === "skipped" ? "skipped" : "—"}
              </p>
            </li>
          );
        })}
      </ol>
      {terminal && (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[12px]", terminal.status === "CANCELLED" ? "bg-danger-soft/40" : "bg-warn-soft/40")}>
          <Badge value={terminal.status} label={terminal.label} dot />
          <span className="num text-fg-muted">{terminal.at ? dateTime(terminal.at) : "—"}</span>
          <span className="text-fg-muted">{terminal.reason ? terminal.reason : terminal.status === "TONU" ? "Truck ordered, not used — a TONU fee can be invoiced." : "No reason recorded."}</span>
        </div>
      )}
    </section>
  );
}
