"use client";

import { useId, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area,
  PieChart, Pie, Cell, Legend, LineChart, Line, Label,
} from "recharts";

import { money, number } from "@/lib/format";
import { ChartEmpty, fmtCompact, fmtMoneyCompact, resolveFormat, type ChartTone, type Format } from "./charts-lite";

// The HTML / SVG pieces live in charts-lite (no Recharts); re-exported so existing imports keep working.
export { Bars, ChartEmpty, Spark, fmtCompact, fmtMoneyCompact, resolveFormat, toneVar, type BarsItem, type ChartTone, type Format } from "./charts-lite";

/* ------------------------------------------------------------------ */
/* Theme — charts read Graphite tokens at runtime                       */
/* ------------------------------------------------------------------ */

const TOKEN_VARS = {
  accent: "--accent", ok: "--ok", warn: "--warn", danger: "--danger", info: "--info", progress: "--progress",
  fg: "--fg", fgMuted: "--fg-muted", fgSubtle: "--fg-subtle", fgFaint: "--fg-faint",
  line: "--line", lineStrong: "--line-strong", surface: "--surface", overlay: "--overlay", sunken: "--sunken",
  raised: "--raised", canvas: "--canvas", neutralSoft: "--neutral-soft",
} as const;

export type ChartTokens = { [K in keyof typeof TOKEN_VARS]: string };

export type ChartTheme = ChartTokens & {
  mode: "light" | "dark";
  /** Fixed-order categorical palette (SERIES_TONES resolved to colours). Index 6 is the grey "Other" slot. */
  series: string[];
  /** Spread onto a Recharts <Tooltip>: overlay background, hairline border, fg text. */
  tooltip: { contentStyle: CSSProperties; itemStyle: CSSProperties; labelStyle: CSSProperties };
  /** Tooltip cursor for line / area charts (vertical hairline). */
  cursorLine: { stroke: string; strokeWidth: number };
  /** Tooltip cursor for bar charts (quiet band). */
  cursorFill: { fill: string };
  /** Axis tick style: 11px fg-subtle. */
  tick: { fontSize: number; fill: string };
  /** Grid stroke: the hairline token. */
  grid: string;
};

/**
 * Categorical series order: the brand blue leads, then hues far from it and from each other (orange,
 * violet, cyan) so every 2-, 3- and 4-series prefix stays distinguishable in both themes.
 * Slots 5–6 (ok, danger) are red/green neighbours — charts with that many series always carry a
 * legend. Never cycle past the list: the last slot (neutral grey) is for "Other".
 */
export const SERIES_TONES: readonly ChartTone[] = ["accent", "warn", "progress", "info", "ok", "danger", "neutral"];

function build(read: (cssVar: string) => string, mode: "light" | "dark"): ChartTheme {
  const keys = Object.keys(TOKEN_VARS) as (keyof typeof TOKEN_VARS)[];
  const t = Object.fromEntries(keys.map((k) => [k, read(TOKEN_VARS[k])])) as ChartTokens;
  const tone = (x: ChartTone) => (x === "neutral" ? t.fgSubtle : t[x]);
  return {
    ...t,
    mode,
    series: SERIES_TONES.map(tone),
    tooltip: {
      contentStyle: {
        background: t.overlay, border: `1px solid ${t.line}`, borderRadius: 8, boxShadow: "var(--shadow-float)",
        color: t.fg, fontSize: 12, lineHeight: "16px", padding: "6px 10px",
      },
      itemStyle: { color: t.fg, padding: "1px 0" },
      labelStyle: { color: t.fgMuted, fontSize: 11, marginBottom: 4 },
    },
    cursorLine: { stroke: t.lineStrong, strokeWidth: 1 },
    cursorFill: { fill: t.neutralSoft },
    tick: { fontSize: 11, fill: t.fgSubtle },
    grid: t.line,
  };
}

// Server / pre-hydration snapshot: plain var() references, so SSR markup is still theme-correct.
const SERVER_THEME = build((v) => `var(${v})`, "light");

const currentMode = (): "light" | "dark" => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

function readTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  return build((v) => cs.getPropertyValue(v).trim() || `var(${v})`, currentMode());
}

// Tiny external store: one MutationObserver on <html data-theme>, shared by every chart on the page.
let cached: ChartTheme | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

let cachedAccent: string | null = null;
const currentAccent = () => document.documentElement.getAttribute("data-accent") ?? "";

function getSnapshot(): ChartTheme {
  if (!cached || cached.mode !== currentMode() || cachedAccent !== currentAccent()) {
    cached = readTheme();
    cachedAccent = currentAccent();
  }
  return cached;
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!observer) {
    observer = new MutationObserver(() => {
      cached = readTheme();
      cachedAccent = currentAccent();
      listeners.forEach((l) => l());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
      cached = null;
    }
  };
}

/** Resolved Graphite tokens for charts; re-renders when the theme toggle flips `data-theme`. */
export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_THEME);
}

/** Non-hook access (event handlers, imperative code). Falls back to var() strings on the server. */
export function chartThemeSnapshot(): ChartTheme {
  return typeof document === "undefined" ? SERVER_THEME : getSnapshot();
}

/* ------------------------------------------------------------------ */
/* Palette helpers                                                     */
/* ------------------------------------------------------------------ */

export function toneColor(theme: ChartTheme, tone: ChartTone): string {
  return tone === "neutral" ? theme.fgSubtle : theme[tone];
}
/** Series colour by index in the fixed order; indexes past the list fold into the grey "Other" slot. */
export function seriesColor(theme: ChartTheme, index: number): string {
  return theme.series[Math.min(Math.max(0, index), theme.series.length - 1)];
}
/** Accepts a tone name ("progress"), a var() string or any CSS colour. Tone names are theme-aware. */
export function resolveColor(theme: ChartTheme, color: string | undefined, fallback: ChartTone = "accent"): string {
  if (!color) return toneColor(theme, fallback);
  return (SERIES_TONES as readonly string[]).includes(color) ? toneColor(theme, color as ChartTone) : color;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const fmtDecimal = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

function legendProps(t: ChartTheme, icon: "square" | "plainline" | "circle" = "plainline") {
  return {
    iconType: icon,
    iconSize: 8,
    wrapperStyle: { fontSize: 12, paddingTop: 6 },
    // Text wears text tokens; the swatch beside it carries identity.
    formatter: (value: ReactNode) => <span style={{ color: t.fgMuted }}>{value}</span>,
  } as const;
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

/** Revenue (area wash) against direct costs (graphite line). The gap between them is the margin. */
export function RevenueChart({ data, height = 260 }: { data: { month: string; revenue: number; cost: number }[]; height?: number }) {
  const t = useChartTheme();
  const rawId = useId();
  const gid = `rev-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (data.length === 0) return <ChartEmpty height={height} hint="Revenue appears here once loads are delivered and invoiced." />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.accent} stopOpacity={0.22} />
            <stop offset="100%" stopColor={t.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="month" tick={t.tick} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtMoneyCompact} tick={t.tick} axisLine={false} tickLine={false} width={52} />
        <Tooltip {...t.tooltip} cursor={t.cursorLine} formatter={(v) => money(Number(v))} />
        <Legend {...legendProps(t)} />
        <Area type="monotone" dataKey="revenue" name="Revenue" stroke={t.accent} strokeWidth={2} fill={`url(#${gid})`}
          activeDot={{ r: 4, fill: t.accent, stroke: t.surface, strokeWidth: 2 }} />
        <Area type="monotone" dataKey="cost" name="Direct costs" stroke={t.fgMuted} strokeWidth={2} fill="transparent"
          activeDot={{ r: 4, fill: t.fgMuted, stroke: t.surface, strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Integer-only series (counts, whole amounts) get integer ticks: no "0.5 claims" on a small axis. */
const allIntegers = (data: Record<string, string | number>[], keys: string[]) =>
  data.every((d) => keys.every((k) => typeof d[k] !== "number" || Number.isInteger(d[k])));

/** Single-series bar chart. `layout="vertical"` for ranked categories (bars grow to the right). */
export function SimpleBar({ data, dataKey, nameKey, money: isMoney = false, color, tone, height = 260, layout = "horizontal", labelWidth = 150, format }: {
  data: Record<string, string | number>[];
  dataKey: string;
  nameKey: string;
  money?: boolean;
  /** Prefer `tone`. Kept for compatibility: a tone name ("progress") or any CSS colour. */
  color?: string;
  tone?: ChartTone;
  height?: number;
  layout?: "horizontal" | "vertical";
  /** Category label column width in vertical layout. */
  labelWidth?: number;
  /** Value formatter for ticks and tooltip; defaults to compact numbers / money. */
  format?: Format;
}) {
  const t = useChartTheme();
  const fill = resolveColor(t, color ?? tone, "accent");
  const tickFmt = resolveFormat(format, isMoney ? fmtMoneyCompact : fmtCompact);
  const fullFmt = resolveFormat(format, isMoney ? (v: number) => money(v) : (v: number) => number(v));
  if (data.length === 0) return <ChartEmpty height={height} />;
  const decimals = !allIntegers(data, [dataKey]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      {layout === "vertical" ? (
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke={t.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={tickFmt} tick={t.tick} axisLine={false} tickLine={false} allowDecimals={decimals} />
          <YAxis type="category" dataKey={nameKey} tick={t.tick} axisLine={false} tickLine={false} width={labelWidth} />
          <Tooltip {...t.tooltip} cursor={t.cursorFill} formatter={(v) => fullFmt(Number(v))} />
          <Bar dataKey={dataKey} fill={fill} maxBarSize={24} radius={[0, 4, 4, 0]} activeBar={{ fillOpacity: 0.8 }} />
        </BarChart>
      ) : (
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey={nameKey} tick={t.tick} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={tickFmt} tick={t.tick} axisLine={false} tickLine={false} width={52} allowDecimals={decimals} />
          <Tooltip {...t.tooltip} cursor={t.cursorFill} formatter={(v) => fullFmt(Number(v))} />
          <Bar dataKey={dataKey} fill={fill} maxBarSize={24} radius={[4, 4, 0, 0]} activeBar={{ fillOpacity: 0.8 }} />
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

/** One or more 2 px lines on a shared axis. Series without `tone`/`color` take the fixed palette order. */
export function TrendLine({ data, lines, height = 240, suffix = "", xKey = "month", format }: {
  data: Record<string, string | number>[];
  lines: { key: string; name: string; color?: string; tone?: ChartTone }[];
  height?: number;
  suffix?: string;
  xKey?: string;
  format?: Format;
}) {
  const t = useChartTheme();
  if (data.length === 0) return <ChartEmpty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={t.tick} axisLine={false} tickLine={false} />
        <YAxis tick={t.tick} axisLine={false} tickLine={false} width={44} unit={suffix} allowDecimals={!allIntegers(data, lines.map((l) => l.key))} />
        <Tooltip {...t.tooltip} cursor={t.cursorLine} formatter={(v) => resolveFormat(format, (x: number) => `${fmtDecimal(x)}${suffix}`)(Number(v))} />
        {lines.length > 1 && <Legend {...legendProps(t)} />}
        {lines.map((l, i) => {
          const c = resolveColor(t, l.color ?? l.tone, SERIES_TONES[i] ?? "neutral");
          return (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={c} strokeWidth={2} dot={false}
              activeDot={{ r: 4, fill: c, stroke: t.surface, strokeWidth: 2 }} />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

type Slice = { name: string; value: number; other?: boolean; tone?: ChartTone };
/**
 * Part-to-whole reads at a glance only up to ~6 slices; the tail folds into "Other".
 * Zero slices are dropped and long lists re-sorted, so a per-slice tone must ride on the datum
 * (never be looked up by position afterwards).
 */
function foldSlices(data: Slice[], max: number): Slice[] {
  const clean = data.filter((d) => d.value > 0);
  if (clean.length <= max) return clean;
  const sorted = [...clean].sort((a, b) => b.value - a.value);
  const rest = sorted.slice(max - 1).reduce((a, d) => a + d.value, 0);
  return [...sorted.slice(0, max - 1), { name: "Other", value: rest, other: true }];
}

function DonutCenter({ viewBox, value, label, theme }: { viewBox?: { cx?: number; cy?: number }; value: ReactNode; label?: string; theme: ChartTheme }) {
  if (!viewBox || viewBox.cx == null || viewBox.cy == null) return null;
  const { cx, cy } = viewBox;
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
      <tspan x={cx} dy={label ? -7 : 0} style={{ fontSize: 18, fontWeight: 600, fill: theme.fg, fontFamily: "var(--font-mono)" }}>{value}</tspan>
      {label && <tspan x={cx} dy={17} style={{ fontSize: 11, fill: theme.fgSubtle }}>{label}</tspan>}
    </text>
  );
}

/** Donut with the total in the centre and a legend that carries the numbers (no label on every slice). */
export function Donut({ data, height = 220, tones, total = true, totalLabel }: {
  data: { name: string; value: number }[];
  height?: number;
  /** Override the palette per slice, e.g. status tones. Indexed like `data` (before zero slices are dropped). */
  tones?: ChartTone[];
  /** Centre figure: the sum by default; `false` to hide, or any node to override. */
  total?: ReactNode;
  totalLabel?: string;
}) {
  const t = useChartTheme();
  const slices = foldSlices(data.map((d, i) => ({ ...d, tone: tones?.[i] })), 6);
  const sum = slices.reduce((a, d) => a + d.value, 0);
  if (slices.length === 0) return <ChartEmpty height={height} />;
  const colorAt = (s: Slice, i: number) => (s.other ? t.fgSubtle : s.tone ? toneColor(t, s.tone) : seriesColor(t, i));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        {/* 2 px stroke in the surface colour is the gap between slices — no border ink. */}
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={0}
          stroke={t.surface} strokeWidth={2} startAngle={90} endAngle={-270}>
          {slices.map((s, i) => <Cell key={s.name} fill={colorAt(s, i)} />)}
          {total !== false && (
            <Label position="center" content={<DonutCenter value={total === true ? fmtCompact(sum) : total} label={totalLabel} theme={t} />} />
          )}
        </Pie>
        <Tooltip {...t.tooltip} formatter={(v, name) => [`${number(Number(v))} · ${sum ? Math.round((Number(v) / sum) * 100) : 0}%`, name]} />
        <Legend iconType="circle" iconSize={8} layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12 }}
          formatter={(value: ReactNode, entry) => {
            const n = (entry as { payload?: { value?: number } }).payload?.value;
            return (
              <span style={{ color: t.fgMuted }}>
                {value}
                {typeof n === "number" && <span className="num" style={{ color: t.fgSubtle, marginLeft: 6 }}>{number(n)}</span>}
              </span>
            );
          }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Small figures: sparkline and ranking bars (plain SVG / HTML)        */
/* ------------------------------------------------------------------ */

