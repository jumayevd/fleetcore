"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Chip, Progress, cn, segmentedThumb, segmentedTrack, type Tone } from "@/components/ui";
import { Spark } from "@/components/charts-lite";
import { DRIVER_TYPE_LABELS, DRIVER_TYPE_SHORT } from "@/lib/constants";
import { money, money2, number } from "@/lib/format";
import type { WeeklyDriverRow, WeeklyTeamRow } from "@/lib/stats";
import type { WeekDay } from "./weekly-data";

const METRICS = ["Amount", "Km", "$/km", "Load #"] as const;
type Metric = (typeof METRICS)[number];
/** Default view: one row per driver (the day's amount, its loads on hover); "All figures" adds km, $/km and load numbers. */
const COMPACT: readonly Metric[] = ["Amount"];
const DRIVER_W = 224;
const METRIC_W = 64;
/** Efficiency bar scale: 150 % fills the track, the marker sits at 100 %. */
const EFF_SCALE = 150;

const effTone = (e: number): Tone => (e >= 100 ? "ok" : e >= 70 ? "warn" : "danger");
const planDelta = (d: number) => <span className={cn("num", d >= 0 ? "text-ok" : "text-danger")}>{d >= 0 ? "+" : "−"}{money(Math.abs(d))}</span>;

type Grand = { total: number; km: number; drivers: number; avgPerTruck: number; rpk: number };

/** 7-day revenue trend, inline SVG (no axes); the row's totals are the readout. */
function DaySpark({ amounts, className }: { amounts: number[]; className?: string }) {
  const any = amounts.some((a) => a > 0);
  return <Spark data={amounts} tone={any ? "progress" : "neutral"} height={16} dot={false} fill={any} className={cn("w-16 shrink-0", className)} />;
}

export function WeeklyBoard({ groups, days, today, grand, goalTotal }: {
  groups: WeeklyTeamRow[];
  /** Weekday columns in company time, labelled on the server. */
  days: WeekDay[];
  /** YYYY-MM-DD in company time from the server, so the highlighted column matches on both sides of hydration. */
  today: string;
  grand: Grand; goalTotal: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState(false);
  const metrics = detail ? METRICS : COMPACT;
  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const cols = (detail ? 2 : 1) + 7 + 6;
  const grandEff = goalTotal ? Math.round((grand.total / goalTotal) * 100) : 0;

  return (
    <>
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className={segmentedTrack} role="group" aria-label="Figures per driver">
        <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)} className={segmentedThumb(!detail)}>Amount</button>
        <button type="button" aria-pressed={detail} onClick={() => setDetail(true)} className={segmentedThumb(detail)}>All figures</button>
      </div>
      <span className="hidden items-center gap-1.5 text-[11px] text-fg-subtle sm:inline-flex"><span className="h-2.5 w-2.5 rounded-sm bg-progress-soft ring-1 ring-inset ring-progress/30" />in transit</span>
    </div>
    <div className="relative max-h-[calc(100vh-300px)] min-h-[300px] overflow-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr className="text-left text-[12px] font-medium text-fg-subtle">
            <th scope="col" className="sticky left-0 z-30 h-9 border-b border-line bg-raised px-3 font-medium" style={{ width: DRIVER_W, minWidth: DRIVER_W }}>Driver</th>
            {detail && <th scope="col" className="sticky z-30 h-9 border-b border-r border-line bg-raised px-2 font-medium" style={{ left: DRIVER_W, width: METRIC_W, minWidth: METRIC_W }}>Metric</th>}
            {days.map((d) => (
              <th key={d.ymd} scope="col" className={cn("h-9 border-b border-line bg-raised px-3 text-right font-medium", d.weekend && "text-fg-faint", d.ymd === today && "text-accent-text")}>
                <span>{d.weekday}</span> <span className="num font-normal normal-case tracking-normal">{d.label}</span>
              </th>
            ))}
            {["Total $", "Total km", "Avg $/km", "Plan Δ", "Days", "Efficiency"].map((h, i) => (
              <th key={h} scope="col" className={cn("h-9 border-b border-line bg-raised px-3 font-medium", i === 0 && "border-l", i < 5 ? "text-right" : "text-left")}>{h}</th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => {
          const key = g.team.id ?? "none";
          const isCollapsed = collapsed.has(key);
          const teamGoal = g.rows.reduce((a, r) => a + r.goal, 0);
          return (
            <tbody key={key}>
              <tr>
                <td colSpan={cols} className="border-b border-line bg-raised p-0">
                  <div className="flex items-center">
                    <button type="button" onClick={() => toggle(key)} title={`Average ${money(g.avgPerTruck)} per driver`} className="sticky left-0 flex h-9 items-center gap-2 px-3 text-left text-[12px] text-fg hover:text-accent-text">
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" /> : <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" />}
                      <span className="h-2 w-2 rounded-full ring-1 ring-line" style={{ background: g.team.color ?? "var(--fg-faint)" }} />
                      <span className="font-semibold">{g.team.name}</span>
                      <span className="num text-fg-subtle">{g.rows.length} {g.rows.length === 1 ? "driver" : "drivers"}</span>
                      <span className="hidden text-fg-subtle sm:inline">·</span>
                      <span className="num hidden text-fg sm:inline">{money(g.total)}</span>
                      <span className={cn("num hidden rounded-full px-1.5 text-[11px] font-medium sm:inline", g.efficiency >= 100 ? "bg-ok-soft text-ok" : g.efficiency >= 70 ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger")}>{g.efficiency}% of {money(teamGoal)}</span>
                      <DaySpark amounts={days.map((_, i) => g.rows.reduce((a, r) => a + r.days[i].amount, 0))} className="ml-1 hidden sm:block" />
                    </button>
                  </div>
                </td>
              </tr>
              {!isCollapsed && g.rows.map((r) => <DriverRows key={r.driver.id} r={r} days={days} metrics={metrics} />)}
            </tbody>
          );
        })}
        <tfoot className="sticky bottom-0 z-20">
          <tr className="bg-sunken text-[12px] font-semibold text-fg">
            <td className="sticky left-0 z-30 border-t border-line bg-sunken px-3 py-2" style={{ width: DRIVER_W, minWidth: DRIVER_W }}>Grand total <span className="num ml-1 font-normal text-fg-subtle">{grand.drivers} drivers</span></td>
            {detail && <td className="sticky z-30 border-r border-t border-line bg-sunken px-2 py-2" style={{ left: DRIVER_W }} />}
            {days.map((d, i) => {
              const dayTotal = groups.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.days[i].amount, 0), 0);
              return <td key={d.ymd} className="num border-t border-line px-3 py-2 text-right">{dayTotal ? money(dayTotal) : <span className="text-fg-faint">—</span>}</td>;
            })}
            <td className="num border-l border-t border-line px-3 py-2 text-right">{money(grand.total)}</td>
            <td className="num border-t border-line px-3 py-2 text-right">{number(Math.round(grand.km))}</td>
            <td className="num border-t border-line px-3 py-2 text-right">{money2(grand.rpk)}</td>
            <td className="border-t border-line px-3 py-2 text-right">{planDelta(grand.total - goalTotal)}</td>
            <td className="num border-t border-line px-3 py-2 text-right text-fg-muted">avg {money(grand.avgPerTruck)}</td>
            <td className="border-t border-line px-3 py-2"><Efficiency value={grandEff} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}

function DriverRows({ r, days, metrics }: { r: WeeklyDriverRow; days: WeekDay[]; metrics: readonly Metric[] }) {
  const stickyBg = "var(--surface)";
  const span = metrics.length;
  const compact = span === 1;
  return (
    <>
      {metrics.map((m, mi) => {
        const last = mi === span - 1;
        const rowBorder = last ? "border-b border-line" : "";
        return (
          <tr key={m} className="group/row hover:[&>td:not([rowspan])]:bg-raised">
            {mi === 0 && (
              <td rowSpan={span} className={cn("sticky left-0 z-10 border-b border-line px-3", compact ? "align-middle" : "align-top")} style={{ background: stickyBg, width: DRIVER_W, minWidth: DRIVER_W, maxWidth: DRIVER_W }}
                title={compact ? `${r.driver.truck ?? "No truck"} · goal ${money(r.goal)}` : undefined}>
                <div className={cn("flex items-center gap-1.5", !compact && "pt-1.5")}>
                  <Link href={`/drivers/${r.driver.id}`} className="truncate font-medium text-fg hover:text-accent-text hover:underline">{r.driver.name}</Link>
                  <Chip title={DRIVER_TYPE_LABELS[r.driver.type] ?? r.driver.type}>{DRIVER_TYPE_SHORT[r.driver.type] ?? r.driver.type}</Chip>
                  {r.driver.hold && <Chip tone="warn">Hold</Chip>}
                </div>
                {!compact && (
                  <>
                    <div className="mt-0.5 text-[11px] text-fg-subtle">{r.driver.truck ? <span className="num">{r.driver.truck}</span> : "No truck"} · goal <span className="num">{money(r.goal)}</span></div>
                    <DaySpark amounts={r.days.map((c) => c.amount)} className="mt-2" />
                  </>
                )}
              </td>
            )}
            {!compact && <td className={cn("sticky z-10 border-r border-line px-2 text-[11px] text-fg-subtle", rowBorder)} style={{ background: stickyBg, left: DRIVER_W, width: METRIC_W, minWidth: METRIC_W }}>{m}</td>}
            {r.days.map((c, di) => {
              const transit = c.loads.some((l) => l.status === "IN_TRANSIT");
              const empty = c.loads.length === 0;
              return (
                <td key={di} className={cn("num whitespace-nowrap px-3 text-right text-[12px]", compact ? "h-10" : "h-7", rowBorder, transit && "bg-progress-soft", days[di].weekend && empty && "text-fg-faint")}
                  title={compact && !empty ? c.loads.map((l) => l.reference).join(", ") + (c.km ? ` · ${number(Math.round(c.km))} km · ${money2(c.amount / c.km)}/km` : "") : undefined}>
                  {compact && c.loads.length === 1
                    ? <Link href={`/loads/${c.loads[0].id}`} className="hover:underline"><DayCell metric={m} cell={c} /></Link>
                    : <DayCell metric={m} cell={c} />}
                </td>
              );
            })}
            {mi === 0 && (
              <>
                <td rowSpan={span} className="num border-b border-l border-line px-3 text-right align-middle font-semibold text-fg">{r.total ? money(r.total) : <span className="font-normal text-fg-faint">—</span>}</td>
                <td rowSpan={span} className="num border-b border-line px-3 text-right align-middle text-fg-muted">{r.km ? number(Math.round(r.km)) : <span className="text-fg-faint">—</span>}</td>
                <td rowSpan={span} className="num border-b border-line px-3 text-right align-middle text-fg-muted">{r.rpk ? money2(r.rpk) : <span className="text-fg-faint">—</span>}</td>
                <td rowSpan={span} className="border-b border-line px-3 text-right align-middle">{planDelta(r.planDelta)}</td>
                <td rowSpan={span} className="num border-b border-line px-3 text-right align-middle text-fg-muted">{r.daysWorked}<span className="text-fg-faint">/7</span></td>
                <td rowSpan={span} className="border-b border-line px-3 align-middle"><Efficiency value={r.efficiency} /></td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

function DayCell({ metric, cell }: { metric: Metric; cell: WeeklyDriverRow["days"][number] }): ReactNode {
  if (!cell.loads.length) return <span className="text-fg-faint">—</span>;
  switch (metric) {
    case "Amount": return <span className="text-fg">{money(cell.amount)}</span>;
    case "Km": return <span className="text-fg-muted">{number(Math.round(cell.km))}</span>;
    case "$/km": return <span className="text-fg-muted">{cell.km ? money2(cell.amount / cell.km) : "—"}</span>;
    case "Load #":
      return (
        <span className="inline-flex flex-wrap justify-end gap-x-1.5">
          {cell.loads.map((l) => (
            <Link key={l.id} href={`/loads/${l.id}`} title={l.status.toLowerCase().replace(/_/g, " ")}
              className={cn("text-[11px] hover:underline", l.status === "IN_TRANSIT" ? "text-progress" : l.status === "CANCELLED" || l.status === "TONU" ? "text-fg-faint line-through" : "text-fg-muted hover:text-fg")}>
              {l.reference}
            </Link>
          ))}
        </span>
      );
  }
}

function Efficiency({ value }: { value: number }) {
  return (
    <div className="w-32" title={`${value}% of goal · marker = 100%`}>
      <div className="flex items-baseline justify-between text-[11px]"><span className={cn("num font-medium", value >= 100 ? "text-ok" : value >= 70 ? "text-warn" : "text-danger")}>{value}%</span></div>
      <Progress value={value / EFF_SCALE} marker={100 / EFF_SCALE} tone={effTone(value)} className="mt-1 h-1" />
    </div>
  );
}
