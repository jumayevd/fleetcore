import { format } from "date-fns";
import type { MonthSpend } from "@/lib/stats";
import { fmtMoneyCompact, money } from "@/lib/format";
import { ChartEmpty } from "@/components/charts-lite";
import { cn } from "@/components/ui";

/*
 * Monthly running costs as stacked columns: maintenance on the baseline (the part a fleet specialist steers), fuel on
 * top. Plain HTML, rendered on the server: each month shows its figures on hover or keyboard focus and is labelled for
 * screen readers; the "monthly" CSV export is the table view. Colours are tokens (violet and orange, chart palette
 * slots that pass the colour-vision checks), so both themes and every accent choice read the same.
 */

export const SERIES = {
  maintenance: { label: "Maintenance", swatch: "bg-progress" },
  fuel: { label: "Fuel", swatch: "bg-warn" },
} as const;

/** A step of 1, 2, 2.5 or 5 × 10ⁿ, so the axis reads in round amounts. */
function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function SpendChart({ data, height = 200 }: { data: MonthSpend[]; height?: number }) {
  const totals = data.map((d) => d.maintenance + d.fuel);
  const max = Math.max(0, ...totals);
  if (max === 0) {
    return <ChartEmpty height={height + 40} title="No running costs yet" hint="Complete work orders and log fuel fills on the trucks; each month's maintenance and fuel spend builds up here." />;
  }
  const step = niceStep(max / 4);
  const top = step * Math.ceil(max / step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const pct = (v: number) => `${(v / top) * 100}%`;
  const sum = { maintenance: data.reduce((a, d) => a + d.maintenance, 0), fuel: data.reduce((a, d) => a + d.fuel, 0) };
  const short = (d: MonthSpend, i: number) => format(d.from, i === 0 || d.from.getMonth() === 0 ? "MMM yy" : "MMM");

  return (
    <div>
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" aria-label="Legend">
        {(Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5 text-fg-muted">
            <span className={cn("h-2 w-2 rounded-sm", SERIES[k].swatch)} aria-hidden />
            {SERIES[k].label}
            <span className="num text-fg-subtle">{money(sum[k])}</span>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative w-11 shrink-0" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 translate-y-1/2 text-[11px] leading-none text-fg-subtle" style={{ bottom: pct(t) }}>{fmtMoneyCompact(t)}</span>
          ))}
        </div>
        {/* Plot */}
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((t) => <div key={t} aria-hidden className={cn("absolute inset-x-0 border-t", t === 0 ? "border-line-strong" : "border-line")} style={{ bottom: pct(t) }} />)}
          <div className="absolute inset-0 flex items-end gap-1">
            {data.map((d, i) => {
              const total = d.maintenance + d.fuel;
              const edge = i < 2 ? "left-0" : i > data.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
              const said = `${d.label}${d.partial ? " to date" : ""}: maintenance ${money(d.maintenance)}, fuel ${money(d.fuel)}, total ${money(total)}`;
              return (
                <div key={d.key} tabIndex={0} role="img" aria-label={said}
                  className="group/col relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none transition-colors hover:bg-raised focus-visible:bg-raised focus-visible:ring-2 focus-visible:ring-accent/40">
                  {total > 0 && (
                    <div className="flex w-full max-w-7 flex-col-reverse gap-[2px]" style={{ height: pct(total) }}>
                      {d.maintenance > 0 && <span className={cn("block w-full", SERIES.maintenance.swatch, d.fuel <= 0 && "rounded-t-[4px]")} style={{ height: `${(d.maintenance / total) * 100}%` }} />}
                      {d.fuel > 0 && <span className={cn("block w-full rounded-t-[4px]", SERIES.fuel.swatch)} style={{ height: `${(d.fuel / total) * 100}%` }} />}
                    </div>
                  )}
                  <span aria-hidden
                    className={cn("pointer-events-none absolute top-0 z-20 w-max rounded-md bg-fg px-2 py-1.5 text-[11px] leading-4 text-surface opacity-0 shadow-float transition-opacity duration-150 group-hover/col:opacity-100 group-focus-visible/col:opacity-100", edge)}>
                    <span className="block font-medium">{d.label}{d.partial ? " · to date" : ""}</span>
                    <span className="num block">Maintenance {money(d.maintenance)}{d.jobs ? ` · ${d.jobs} ${d.jobs === 1 ? "job" : "jobs"}` : ""}</span>
                    <span className="num block">Fuel {money(d.fuel)}{d.liters ? ` · ${d.liters.toLocaleString("en-US")} L` : ""}</span>
                    <span className="num block opacity-80">Total {money(total)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* X axis */}
      {/* Offset = y-axis width (w-11) + gap (gap-2). */}
      <div className="ml-[3.25rem] mt-1.5 flex gap-1" aria-hidden>
        {data.map((d, i) => (
          <span key={d.key} className={cn("num min-w-0 flex-1 truncate text-center text-[11px]", d.partial ? "text-fg-muted" : "text-fg-subtle")}>{short(d, i)}</span>
        ))}
      </div>
    </div>
  );
}
