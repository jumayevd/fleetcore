import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./ui";
import { fmtCompact, fmtMoneyCompact, money, number } from "@/lib/format";

/*
 * Chart pieces drawn in plain HTML / SVG: sparklines, ranking bars, empty slots, tones and value formats.
 * No Recharts here, and no "use client": server pages render these with zero JavaScript, and pages that only
 * need them never download the charting library. The Recharts charts live in charts.tsx.
 */

export type ChartTone = "accent" | "ok" | "warn" | "danger" | "info" | "progress" | "neutral";

const toneVarName = (tone: ChartTone) => (tone === "neutral" ? "--fg-subtle" : `--${tone}`);
/** `var(--tone)` string for inline styles outside the hook (server components, Leaflet HTML). */
export const toneVar = (tone: ChartTone) => `var(${toneVarName(tone)})`;

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

// Pure number formatters live in lib/format so server components can use them too; re-exported for existing imports.
export { fmtCompact, fmtMoneyCompact };

/** Value formatter: a function (client callers) or a preset name (server components can't pass functions). */
export type Format = ((v: number) => string) | "money" | "moneyCompact" | "compact" | "number" | "percent" | "km";
export function resolveFormat(f: Format | undefined, fallback: (v: number) => string): (v: number) => string {
  if (!f) return fallback;
  if (typeof f === "function") return f;
  switch (f) {
    case "money": return (v) => money(v);
    case "moneyCompact": return fmtMoneyCompact;
    case "compact": return fmtCompact;
    case "percent": return (v) => `${Math.round(v)}%`;
    case "km": return (v) => `${number(v)} km`;
    default: return (v) => number(v);
  }
}

/** Placeholder for a chart slot with no data yet. Says what to do next. */
export function ChartEmpty({ height = 220, title = "No data yet", hint, className }: { height?: number; title?: string; hint?: string; className?: string }) {
  return (
    <div style={{ height }} className={cn("flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line text-center", className)}>
      <p className="text-[12px] font-medium text-fg-muted">{title}</p>
      {hint && <p className="max-w-xs text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

/**
 * Tiny area sparkline for Stat tiles. No axes, no tooltip; the tile's value is the readout.
 * Renders on the server (pure SVG with var() colours) so tiles never flash empty.
 */
export function Spark({ data, tone = "neutral", height = 28, className, fill = true, dot = true }: {
  data: number[];
  tone?: ChartTone;
  height?: number;
  className?: string;
  /** Area wash under the line (~12 % opacity). */
  fill?: boolean;
  /** Mark the latest point. Neutral sparklines mark it in amber (the current period is the signal). */
  dot?: boolean;
}) {
  const clean = data.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return <div style={{ height }} className={cn("rounded-sm bg-sunken/60", className)} aria-hidden />;
  const w = 100;
  const pad = 2;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const pts = clean.map((v, i) => [(i / (clean.length - 1)) * w, pad + (1 - (v - min) / range) * (height - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w} ${height} L0 ${height} Z`;
  const color = toneVar(tone);
  const dotColor = tone === "neutral" ? toneVar("accent") : color;
  const [, lastY] = pts[pts.length - 1];
  return (
    <div className={cn("relative", className)} style={{ height }} aria-hidden>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block overflow-visible">
        {fill && <path d={area} style={{ fill: color, fillOpacity: 0.12 }} />}
        <path d={line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: color, strokeWidth: 1.5, strokeLinejoin: "round", strokeLinecap: "round" }} />
      </svg>
      {dot && (
        <span className="absolute h-1.5 w-1.5 rounded-full"
          style={{ right: -3, top: lastY - 3, background: dotColor, boxShadow: "0 0 0 2px var(--surface)" }} />
      )}
    </div>
  );
}

export type BarsItem = { label: ReactNode; value: number; hint?: string; tone?: ChartTone; href?: string };

/** Horizontal mini bars for ranking lists (top customers, spend by category). HTML, server-renderable. */
export function Bars({ data, tone = "info", format, max, labelWidth = 120, valueWidth = 64, showValue = true, className }: {
  data: BarsItem[];
  tone?: ChartTone;
  format?: Format;
  /** Scale top; defaults to the largest value. */
  max?: number;
  labelWidth?: number | string;
  valueWidth?: number | string;
  showValue?: boolean;
  className?: string;
}) {
  if (data.length === 0) return <ChartEmpty height={96} className={className} />;
  const top = max ?? (Math.max(...data.map((d) => d.value), 0) || 1);
  return (
    <ul className={cn("space-y-1", className)}>
      {data.map((d, i) => {
        const pct = Math.max(0, Math.min(100, (d.value / top) * 100));
        const color = toneVar(d.tone ?? tone);
        const row = (
          <>
            <span className="min-w-0 shrink-0 truncate text-[12px] text-fg-muted" style={{ width: labelWidth }}>{d.label}</span>
            <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-sunken">
              <span className="absolute inset-y-0 left-0 rounded-r-sm" style={{ width: `${pct}%`, background: color }} />
            </span>
            {showValue && <span className="num shrink-0 text-right text-[12px] text-fg" style={{ width: valueWidth }}>{resolveFormat(format, (v) => number(v))(d.value)}</span>}
          </>
        );
        const cls = "-mx-1.5 flex items-center gap-3 rounded px-1.5 py-1 hover:bg-raised";
        return (
          <li key={i} title={d.hint}>
            {d.href ? <Link href={d.href} className={cls}>{row}</Link> : <div className={cls}>{row}</div>}
          </li>
        );
      })}
    </ul>
  );
}
