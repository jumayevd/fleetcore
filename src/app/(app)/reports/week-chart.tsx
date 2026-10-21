import { ChartEmpty } from "@/components/charts-lite";
import { cn } from "@/components/ui";
import { niceStep } from "./shared";

/*
 * Weekly columns for the inspection reports (defects found vs closed, walk-around videos received). Plain HTML,
 * rendered on the server like the running-cost chart: one column group per week, side-by-side bars for up to two
 * series, a tooltip per week on hover or keyboard focus, and an aria-label that reads the figures. Colours are the
 * same validated violet / orange chart tokens; a single series needs no legend (the card title names it).
 */

export type WeekSeries = { label: string; swatch: string };
export type WeekPoint = {
  key: string;
  /** Short label under the column, e.g. "Oct 12". */
  label: string;
  partial: boolean;
  /** One value per series. For `percent` charts, 0–1 (null: nothing expected that week). */
  values: (number | null)[];
  /** Tooltip lines after the week label. */
  lines: string[];
};

export function WeekChart({ points, series, percent, height = 140, emptyTitle, emptyHint }: {
  points: WeekPoint[];
  series: WeekSeries[];
  percent?: boolean;
  height?: number;
  emptyTitle: string;
  emptyHint: string;
}) {
  const max = Math.max(0, ...points.flatMap((p) => p.values.map((v) => v ?? 0)));
  if (max === 0) return <ChartEmpty height={height + 32} title={emptyTitle} hint={emptyHint} />;
  const step = percent ? 0.25 : niceStep(max / 3, true);
  const top = percent ? 1 : step * Math.ceil(max / step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const pct = (v: number) => `${(v / top) * 100}%`;
  const tick = (t: number) => (percent ? `${Math.round(t * 100)}%` : t.toLocaleString("en-US"));
  // Label every k-th week so the axis never crowds; the current week is always labelled.
  const every = Math.max(1, Math.ceil(points.length / 7));
  const shown = (i: number) => i === points.length - 1 || (points.length - 1 - i) % every === 0;

  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" aria-label="Legend">
          {series.map((s) => (
            <li key={s.label} className="inline-flex items-center gap-1.5 text-fg-muted">
              <span className={cn("h-2 w-2 rounded-sm", s.swatch)} aria-hidden />{s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <div className="relative w-8 shrink-0" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 translate-y-1/2 text-[11px] leading-none text-fg-subtle" style={{ bottom: pct(t) }}>{tick(t)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((t) => <div key={t} aria-hidden className={cn("absolute inset-x-0 border-t", t === 0 ? "border-line-strong" : "border-line")} style={{ bottom: pct(t) }} />)}
          <div className={cn("absolute inset-0 flex items-end", points.length > 20 ? "gap-px" : "gap-1")}>
            {points.map((p, i) => {
              const edge = i < 2 ? "left-0" : i > points.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
              const said = `Week of ${p.label}${p.partial ? " (to date)" : ""}: ${p.lines.join(", ")}`;
              return (
                <div key={p.key} tabIndex={0} role="img" aria-label={said}
                  className="group/col relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-sm outline-none transition-colors hover:bg-raised focus-visible:bg-raised focus-visible:ring-2 focus-visible:ring-accent/40">
                  {p.values.map((v, s) => (
                    v != null && v > 0
                      ? <span key={s} className={cn("block w-full max-w-3 rounded-t-[4px]", series[s]?.swatch, p.partial && "opacity-70")} style={{ height: pct(Math.min(v, top)) }} />
                      : <span key={s} className="block w-full max-w-3" aria-hidden />
                  ))}
                  <span aria-hidden
                    className={cn("pointer-events-none absolute top-0 z-20 w-max rounded-md bg-fg px-2 py-1.5 text-[11px] leading-4 text-surface opacity-0 shadow-float transition-opacity duration-150 group-hover/col:opacity-100 group-focus-visible/col:opacity-100", edge)}>
                    <span className="block font-medium">Week of {p.label}{p.partial ? " · to date" : ""}</span>
                    {p.lines.map((l) => <span key={l} className="num block">{l}</span>)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className={cn("ml-10 mt-1.5 flex", points.length > 20 ? "gap-px" : "gap-1")} aria-hidden>
        {points.map((p, i) => (
          <span key={p.key} className={cn("num min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[11px]", p.partial ? "text-fg-muted" : "text-fg-subtle")}>
            {shown(i) ? p.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
