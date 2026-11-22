import type { ReactNode } from "react";
import {
  AlertTriangle, BarChart3, Calendar, Camera, CheckCircle2, ClipboardCheck, Clock, Download, Droplet, FileWarning, Fuel,
  Gauge, LayoutDashboard, MapPin, Navigation, Receipt, Send, ShieldAlert, Sparkles, Star, Store, Truck, Wrench, type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui";
import { Btn, Float, MockWindow, PageTitle, Pill, at, toneBg, toneDot, type Tone } from "./frame";

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

const STATS: [string, number, string, Tone, LucideIcon][] = [
  ["Oil overdue", 2, "3,412 mi over at worst", "danger", Droplet],
  ["Papers expiring", 5, "2 this week", "warn", FileWarning],
  ["In the shop", 4, "1 past promised date", "progress", Wrench],
  ["Walk-arounds missing", 3, "of 16 this week", "info", ClipboardCheck],
];

const TODAY: [unit: string, who: string, what: string, detail: string, tone: Tone, tag: string, action: string, Icon: LucideIcon][] = [
  ["2204", "Darnell Price", "Oil change overdue", "3,412 mi over · read from ELD today", "danger", "Overdue", "Book service", Droplet],
  ["2201", "Grant Fowler", "Out of service · air leak", "Left steer, reported on walk-around", "danger", "Now", "Create repair", ShieldAlert],
  ["C808", "Keystone Truck Center", "Shop is late", "Promised Tuesday · brake job", "warn", "2 days late", "Chase shop", Store],
  ["2208", "Sean Mitchell", "Registration expires", "Illinois · Nov 24", "warn", "3 days", "Renew", FileWarning],
  ["2206", "Pavel Sokolov", "DOT correction due", "Roadside report VA4573 · 2 violations", "info", "Fri", "Record fix", AlertTriangle],
  ["2210", "Ray Delgado", "No walk-around this week", "Last sent Nov 14", "info", "Missing", "Remind", Camera],
];

export function TodayScene() {
  return (
    <>
      <MockWindow path="today" active="today">
        <PageTitle title="Good morning, Aziza" sub="Friday, Nov 21 · 14 things need a decision" action={<Btn ghost><Calendar className="h-3.5 w-3.5" />This week</Btn>} />
        <div className="grid grid-cols-4 gap-3">
          {STATS.map(([label, n, hint, tone, Icon], i) => (
            <div key={label} className="m-rise rounded-xl border border-line bg-surface p-3" style={at(100 + i * 90)}>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-fg-muted">{label}</span>
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", toneBg(tone))}><Icon className="h-3.5 w-3.5" /></span>
              </div>
              <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight">{n}</p>
              <p className="mt-1.5 text-[10.5px] text-fg-subtle">{hint}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-semibold">Needs attention</span>
            <Pill tone="danger">14</Pill>
            <span className="ml-auto flex gap-1 text-[11px] text-fg-subtle">
              {["All", "Oil", "Shop", "Papers", "PTI", "Drivers"].map((f, i) => <span key={f} className={cn("rounded-md px-2 py-0.5", i === 0 && "bg-sunken font-medium text-fg")}>{f}</span>)}
            </span>
          </div>
          {TODAY.map(([unit, who, what, detail, tone, tag, action, Icon], i) => (
            <div key={unit} className="m-rise flex items-center gap-3 border-b border-line px-4 py-[9px] last:border-0" style={at(450 + i * 130)}>
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", toneBg(tone))}><Icon className="h-3.5 w-3.5" /></span>
              <div className="w-[118px] shrink-0">
                <p className="text-[12.5px] font-semibold">{unit}</p>
                <p className="truncate text-[10.5px] text-fg-subtle">{who}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{what}</p>
                <p className="truncate text-[10.5px] text-fg-subtle">{detail}</p>
              </div>
              <Pill tone={tone}>{tag}</Pill>
              <span className={cn("w-[92px] rounded-md py-1 text-center text-[11px] font-medium", i === 0 ? "bg-accent text-white" : "border border-line text-fg")}>{action}</span>
            </div>
          ))}
        </div>
      </MockWindow>
      <Float className="right-[6px] top-[92px]" delay={1500}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ok-soft text-ok"><CheckCircle2 className="h-4.5 w-4.5" /></span>
          <div><p className="font-semibold">Service booked · 2204</p><p className="text-[11px] text-fg-subtle">Keystone Truck Center · Mon 8:00</p></div>
        </div>
      </Float>
      <Float className="bottom-[14px] left-[6px]" delay={2300}>
        <p className="text-[11px] text-fg-subtle">Cleared this morning</p>
        <div className="mt-1 flex items-center gap-2"><span className="text-[18px] font-semibold">11 of 14</span>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken"><i className="m-grow block h-full w-[78%] rounded-full bg-ok" style={at(2500)} /></span></div>
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Oil changes                                                         */
/* ------------------------------------------------------------------ */

const OIL: [unit: string, kind: string, odo: string, used: number, interval: string, tone: Tone, status: string, shop: string][] = [
  ["2204", "Volvo VNL", "163,225", 1.23, "15,000", "danger", "3,412 mi over", "Keystone Truck Center"],
  ["2201", "Peterbilt 579", "92,332", 1.03, "15,000", "danger", "420 mi over", "Rush Peterbilt"],
  ["2209", "Freightliner Cascadia", "521,065", 0.94, "25,000", "warn", "1,480 mi left", "TA Truck Service"],
  ["2202", "Kenworth T680", "619,629", 0.82, "25,000", "warn", "4,450 mi left", "Keystone Truck Center"],
  ["2205", "Volvo VNL", "624,904", 0.55, "15,000", "ok", "6,720 mi left", "Rush Peterbilt"],
  ["2207", "Freightliner Cascadia", "418,330", 0.31, "25,000", "ok", "17,200 mi left", "TA Truck Service"],
];

export function OilScene() {
  return (
    <>
      <MockWindow path="maintenance/oil" active="maintenance">
        <PageTitle title="Oil changes" sub="Interval by truck type · odometer read from your ELD" action={<Btn><Droplet className="h-3.5 w-3.5" />Log oil change</Btn>} />
        <div className="mb-3 grid grid-cols-4 gap-3">
          {([["Overdue", "2", "danger"], ["Due within 1,500 mi", "2", "warn"], ["On schedule", "11", "ok"], ["Synced today", "16 / 16", "info"]] as [string, string, Tone][]).map(([l, v, t], i) => (
            <div key={l} className="m-rise flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5" style={at(80 + i * 80)}>
              <i className={cn("h-8 w-1.5 rounded-full", toneDot(t))} />
              <div><p className="text-[20px] font-semibold leading-none">{v}</p><p className="mt-1 text-[10.5px] text-fg-subtle">{l}</p></div>
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="grid grid-cols-[150px_1fr_110px_150px] gap-4 border-b border-line bg-raised px-4 py-2 text-[10.5px] font-medium uppercase tracking-wide text-fg-subtle">
            <span>Truck</span><span>Miles used of interval</span><span>Status</span><span>Last shop</span>
          </div>
          {OIL.map(([unit, kind, odo, used, interval, tone, status, shop], i) => (
            <div key={unit} className="m-rise grid grid-cols-[150px_1fr_110px_150px] items-center gap-4 border-b border-line px-4 py-[10px] last:border-0" style={at(350 + i * 110)}>
              <div><p className="text-[12.5px] font-semibold">{unit}</p><p className="truncate text-[10.5px] text-fg-subtle">{kind}</p></div>
              <div>
                <div className="relative h-2 overflow-hidden rounded-full bg-sunken">
                  <i className={cn("m-grow absolute inset-y-0 left-0 rounded-full", tone === "danger" ? "bg-linear-to-r from-[#f97066] to-[#d92d20]" : tone === "warn" ? "bg-linear-to-r from-[#fdb022] to-[#f79009]" : "bg-linear-to-r from-[#47cd89] to-[#079455]")}
                    style={{ width: `${Math.min(used, 1) * 100}%`, ...at(500 + i * 110) }} />
                </div>
                <p className="mt-1 text-[10.5px] text-fg-subtle">{Math.round(used * 100)}% of {interval} mi · odometer {odo} mi</p>
              </div>
              <Pill tone={tone} dot>{status}</Pill>
              <span className="truncate text-[11.5px] text-fg-muted">{shop}</span>
            </div>
          ))}
        </div>
      </MockWindow>
      <Float className="bottom-[14px] right-[26px]" delay={1400}>
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5"><i className="m-ping absolute inset-0 rounded-full bg-ok" /><i className="relative h-2.5 w-2.5 rounded-full bg-ok" /></span>
          <div><p className="font-semibold">ELD synced · just now</p><p className="text-[11px] text-fg-subtle">2209 · 521,065 mi · 14,212 engine h</p></div>
        </div>
      </Float>
      <Float className="bottom-[18px] left-[10px]" delay={2200}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent-text"><Gauge className="h-4 w-4" /></span>
          <div><p className="font-semibold">Interval by truck type</p><p className="text-[11px] text-fg-subtle">Volvo VNL · every 15,000 mi</p></div>
        </div>
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Repairs                                                             */
/* ------------------------------------------------------------------ */

const BOARD: [stage: string, tone: Tone, cards: [unit: string, job: string, shop: string, when: string, cost: string, late?: boolean][]][] = [
  ["Booked", "info", [["2204", "Oil & filter service", "Keystone Truck Center", "Mon 8:00", "$410"], ["T-14", "Trailer brake lights", "Mobile Fleet Repair", "Tue", "$180"]]],
  ["In the shop", "progress", [["C808", "Brake job, drive axle", "Keystone Truck Center", "Promised Tue", "$1,842", true], ["2201", "Air leak, left steer", "Rush Peterbilt", "Today 16:00", "$620"]]],
  ["Waiting for parts", "warn", [["2207", "Turbo actuator", "TA Truck Service", "Part due Mon", "$2,310"]]],
  ["Back on the road", "ok", [["2203", "Steer tires ×2", "Love's Tire Care", "Done Wed", "$1,120"], ["2206", "DOT annual", "Rush Peterbilt", "Done Tue", "$245"]]],
];

/** Running number of each card across the board, for the entrance stagger. */
const CARD_AT = BOARD.map((_, col) => BOARD.slice(0, col).reduce((sum, [, , c]) => sum + c.length, 0));

export function RepairsScene() {
  return (
    <>
      <MockWindow path="maintenance/work-orders" active="maintenance">
        <PageTitle title="Repairs" sub="7 open · 4 trucks down · $6,727 this week" action={<Btn><Wrench className="h-3.5 w-3.5" />New repair</Btn>} />
        <div className="grid grid-cols-4 gap-3">
          {BOARD.map(([stage, tone, cards], col) => (
            <div key={stage} className="rounded-xl bg-sunken/70 p-2">
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <i className={cn("h-2 w-2 rounded-full", toneDot(tone))} />
                <span className="text-[11.5px] font-semibold">{stage}</span>
                <span className="ml-auto text-[11px] text-fg-subtle">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map(([unit, job, shop, when, cost, late], k) => (
                  <div key={unit + job} className={cn("m-rise rounded-lg border bg-surface p-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]", late ? "border-danger/40" : "border-line")} style={at(200 + (CARD_AT[col] + k) * 120)}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold"><Truck className="h-3.5 w-3.5 text-fg-subtle" />{unit}</span>
                      <span className="text-[11.5px] font-semibold">{cost}</span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] font-medium leading-snug">{job}</p>
                    <p className="mt-0.5 truncate text-[10.5px] text-fg-subtle">{shop}</p>
                    <div className="mt-2 flex items-center gap-1">
                      {late ? <Pill tone="danger"><Clock className="h-3 w-3" />2 days late</Pill> : <Pill tone="neutral"><Clock className="h-3 w-3" />{when}</Pill>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="m-rise mt-3 flex items-center gap-6 rounded-xl border border-line bg-surface px-4 py-3" style={at(1300)}>
          {[["Downtime this month", "38 truck-days"], ["Avg. time in shop", "2.4 days"], ["Late shops", "1"]].map(([l, v]) => (
            <div key={l}><p className="text-[10.5px] text-fg-subtle">{l}</p><p className="text-[15px] font-semibold">{v}</p></div>
          ))}
          <span className="ml-auto"><Btn ghost><Send className="h-3.5 w-3.5" />Email Keystone</Btn></span>
        </div>
      </MockWindow>
      <Float className="bottom-[40px] right-[60px] w-[230px]" delay={1700}>
        <p className="flex items-center gap-1.5 font-semibold"><Receipt className="h-3.5 w-3.5 text-accent-text" />Invoice · C808</p>
        <div className="mt-2 space-y-1 text-[11px]">
          {[["Brakes", "$1,240"], ["Labor 4 h", "$480"], ["Shop supplies", "$122"]].map(([k, v]) => <p key={k} className="flex justify-between text-fg-muted"><span>{k}</span><span>{v}</span></p>)}
          <p className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span>$1,842</span></p>
        </div>
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Inspections                                                         */
/* ------------------------------------------------------------------ */

const PTI: [unit: string, tone: Tone, label: string][] = [
  ["2201", "danger", "Defect"], ["2202", "ok", "Reviewed"], ["2203", "ok", "Reviewed"], ["2204", "accent", "Sent"],
  ["2205", "ok", "Reviewed"], ["2206", "accent", "Sent"], ["2207", "ok", "Reviewed"], ["2208", "warn", "Soon"],
  ["2209", "ok", "Reviewed"], ["2210", "neutral", "Missing"], ["2211", "ok", "Reviewed"], ["2212", "neutral", "Missing"],
];

export function InspectionsScene() {
  return (
    <>
      <MockWindow path="inspections" active="inspections">
        <PageTitle title="Pre-trip board" sub="Week of Nov 17 · 13 of 16 walk-arounds in" action={<Btn ghost><Camera className="h-3.5 w-3.5" />Remind missing (3)</Btn>} />
        <div className="grid grid-cols-[1fr_272px] gap-3">
          <div>
          <div className="grid grid-cols-4 content-start gap-2">
            {PTI.map(([unit, tone, label], i) => (
              <div key={unit} className={cn("m-pop rounded-lg border bg-surface p-2.5", tone === "danger" ? "border-danger/50 ring-2 ring-danger/15" : "border-line")} style={at(120 + i * 70)}>
                <div className="flex items-center justify-between"><span className="text-[12.5px] font-semibold">{unit}</span>
                  {tone === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> : tone === "danger" ? <AlertTriangle className="h-3.5 w-3.5 text-danger" /> : null}</div>
                <Pill tone={tone} className="mt-2">{label}</Pill>
              </div>
            ))}
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
            <p className="border-b border-line px-3 py-2 text-[12px] font-semibold">Open defects</p>
            {([["DEF-0062", "2201", "Air leak, left steer", "Bekzod", "Fri", "danger", "Out of service"], ["DEF-0059", "2208", "Marker light out", "Aziza", "Mon", "warn", "Fix soon"], ["DEF-0057", "T-14", "Mud flap torn", "Timur", "Wed", "info", "In repair"]] as [string, string, string, string, string, Tone, string][]).map(([id, unit, what, who, due, tone, tag], i) => (
              <div key={id} className="m-rise flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-0" style={at(1300 + i * 140)}>
                <span className="w-[58px] text-[10.5px] font-medium text-fg-subtle">{id}</span>
                <span className="w-9 text-[12px] font-semibold">{unit}</span>
                <span className="min-w-0 flex-1 truncate text-[12px]">{what}</span>
                <span className="text-[10.5px] text-fg-subtle">{who} · due {due}</span>
                <Pill tone={tone}>{tag}</Pill>
              </div>
            ))}
          </div>
          </div>
          <div className="m-rise rounded-xl border border-line bg-surface p-3" style={at(1100)}>
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold">2201 · walk-around</span><Pill tone="danger">Out of service</Pill></div>
            <p className="text-[10.5px] text-fg-subtle">Grant Fowler · Thu 6:42</p>
            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              {[["from-[#cbd5e1] to-[#94a3b8]", "Tires"], ["from-[#fde68a] to-[#f59e0b]", "Lights"], ["from-[#fecaca] to-[#ef4444]", "Air lines"]].map(([g, l]) => (
                <div key={l} className={cn("flex h-[58px] items-end rounded-md bg-linear-to-br p-1", g)}><span className="rounded bg-black/45 px-1 text-[9.5px] font-medium text-white">{l}</span></div>
              ))}
            </div>
            <ul className="mt-2.5 space-y-1.5 text-[11.5px]">
              {[["Tires & wheels", true], ["Lights & reflectors", true], ["Brakes & air lines", false], ["Safety equipment", true]].map(([l, ok]) => (
                <li key={l as string} className="flex items-center gap-1.5">{ok ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> : <AlertTriangle className="h-3.5 w-3.5 text-danger" />}<span className={ok ? "" : "font-medium text-danger"}>{l}</span></li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-center gap-0.5 border-t border-line pt-2">
              {[0, 1, 2, 3].map((s) => <Star key={s} className="h-3.5 w-3.5 fill-[#fdb022] text-[#fdb022]" />)}<Star className="h-3.5 w-3.5 text-fg-faint" />
              <span className="ml-1.5 text-[10.5px] text-fg-subtle">Reviewed by Aziza</span>
            </div>
          </div>
        </div>
      </MockWindow>
      <Float className="bottom-[16px] right-[14px]" delay={1900}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-[#f97316] to-[#ef4444] text-[10px] font-semibold text-white">BR</span>
          <div><p className="font-semibold">Defect DEF-0062 → Bekzod</p><p className="text-[11px] text-fg-subtle">Air leak, left steer · due Friday</p></div>
        </div>
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Live map                                                            */
/* ------------------------------------------------------------------ */

const ROUTE = "M 60 330 C 140 300, 190 250, 260 240 S 400 180, 470 120";
const TRUCKS: [unit: string, x: number, y: number, tone: string][] = [
  ["2204", 120, 120, "#2563eb"], ["2207", 380, 300, "#2563eb"], ["2202", 210, 380, "#f79009"], ["2205", 505, 250, "#2563eb"], ["2210", 330, 60, "#98a2b3"],
];
const FLEET: [unit: string, where: string, speed: string, fuel: number][] = [
  ["2209", "I-90 · Toledo, OH", "62 mph", 0.71], ["2204", "Gary, IN", "Parked", 0.38], ["2207", "I-65 · Lafayette, IN", "58 mph", 0.84],
  ["2202", "Joliet, IL", "Idle", 0.22], ["2205", "I-94 · Kalamazoo, MI", "64 mph", 0.56],
];

export function MapScene() {
  return (
    <>
      <MockWindow path="tracking" active="tracking" flush>
        <div className="flex h-full">
          <div className="relative min-w-0 flex-1 overflow-hidden bg-[#eaf0f6]">
            <svg viewBox="0 0 560 476" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
              <path d="M 330 -10 C 300 60, 340 120, 310 190 C 290 240, 320 260, 300 300 L 270 300 C 280 240, 250 200, 270 140 C 285 90, 260 40, 280 -10 Z" fill="#bfdbfe" />
              {[60, 140, 220, 300, 380, 460].map((y) => <path key={y} d={`M0 ${y} L560 ${y + 20}`} stroke="#fff" strokeWidth="3" />)}
              {[80, 180, 380, 480].map((x) => <path key={x} d={`M${x} 0 L${x - 30} 476`} stroke="#fff" strokeWidth="3" />)}
              <path d="M -10 360 C 120 330, 200 260, 300 250 S 460 150, 580 110" stroke="#fde68a" strokeWidth="7" fill="none" />
              <path d="M 150 -10 C 170 120, 230 260, 220 490" stroke="#fde68a" strokeWidth="6" fill="none" />
              <path d={ROUTE} stroke="#2563eb" strokeWidth="4" fill="none" strokeLinecap="round" className="m-draw" style={{ ["--len" as string]: 520, ...at(300) }} />
              {[["Chicago", 230, 205], ["Gary", 120, 150], ["Toledo", 480, 100], ["Joliet", 190, 410]].map(([c, x, y]) => (
                <text key={c as string} x={x as number} y={y as number} fontSize="11" fill="#667085" fontWeight="600">{c}</text>
              ))}
            </svg>
            {TRUCKS.map(([unit, x, y, color], i) => (
              <div key={unit} className="m-pop absolute" style={{ left: `${(x / 560) * 100}%`, top: `${(y / 476) * 100}%`, ...at(400 + i * 150) }}>
                <span className="relative -ml-3 -mt-3 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-md ring-2 ring-white" style={{ background: color }}>
                  <Truck className="h-3 w-3" />
                </span>
                <span className="absolute left-4 top-[-6px] rounded bg-white/95 px-1 text-[10px] font-semibold shadow-sm">{unit}</span>
              </div>
            ))}
            <svg viewBox="0 0 560 476" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
              <g className="m-drive" style={{ offsetPath: `path("${ROUTE}")` }}>
                <circle r="16" fill="#2563eb" opacity="0.18" className="m-blink" />
                <circle r="9" fill="#2563eb" stroke="#fff" strokeWidth="3" />
              </g>
            </svg>
            <div className="absolute left-3 top-3 flex gap-1.5">
              <Pill tone="ok" dot className="bg-white shadow-sm">12 moving</Pill><Pill tone="neutral" className="bg-white shadow-sm">4 parked</Pill>
            </div>
          </div>
          <div className="w-[236px] shrink-0 border-l border-line bg-surface p-3">
            <p className="text-[13px] font-semibold">Fleet now</p>
            <p className="text-[10.5px] text-fg-subtle">From TrackPro · updated 1 min ago</p>
            <div className="mt-2.5 space-y-2">
              {FLEET.map(([unit, where, speed, fuel], i) => (
                <div key={unit} className="m-rise rounded-lg border border-line p-2" style={at(300 + i * 120)}>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-[12px] font-semibold"><Navigation className="h-3 w-3 text-accent-text" />{unit}</span><span className="text-[10.5px] text-fg-subtle">{speed}</span></div>
                  <p className="truncate text-[10.5px] text-fg-subtle">{where}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Fuel className="h-3 w-3 text-fg-subtle" />
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"><i className={cn("m-grow block h-full rounded-full", fuel < 0.3 ? "bg-danger" : fuel < 0.5 ? "bg-[#f79009]" : "bg-ok")} style={{ width: `${fuel * 100}%`, ...at(500 + i * 120) }} /></span>
                    <span className="w-7 text-right text-[10px] text-fg-muted">{Math.round(fuel * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </MockWindow>
      <Float className="bottom-[22px] left-[236px]" delay={1600}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white"><MapPin className="h-4 w-4" /></span>
          <div><p className="font-semibold">2209 · I-90 near Toledo</p><p className="text-[11px] text-fg-subtle">62 mph · fuel 71% · 521,065 mi</p></div>
        </div>
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

const MONTHS = [38, 44, 41, 52, 47, 58, 49, 55, 62, 51, 59, 48];
const SPEND: [string, number, string][] = [["Engine", 0.34, "#6366f1"], ["Brakes", 0.22, "#0ea5e9"], ["Tires", 0.19, "#22c55e"], ["Labor", 0.15, "#f59e0b"], ["Other", 0.1, "#cbd5e1"]];
/** Where each slice of the donut starts, in % of the ring. */
const SPEND_AT = SPEND.map((_, i) => SPEND.slice(0, i).reduce((sum, [, f]) => sum + f * 100, 0));

export function ReportsScene() {
  return (
    <>
      <MockWindow path="reports" active="reports">
        <PageTitle title="Reports" sub="Maintenance spend · last 12 months" action={<Btn ghost><Download className="h-3.5 w-3.5" />Export CSV</Btn>} />
        <div className="grid grid-cols-3 gap-3">
          {[["Spend this month", "$48,210", "−18% vs October", "ok"], ["Cost per mile", "$0.142", "−$0.011", "ok"], ["Downtime", "38 truck-days", "+4 vs October", "danger"]].map(([l, v, d, t], i) => (
            <div key={l} className="m-rise rounded-xl border border-line bg-surface p-3" style={at(80 + i * 90)}>
              <p className="text-[11px] text-fg-muted">{l}</p>
              <p className="mt-1 text-[22px] font-semibold leading-none tracking-tight">{v}</p>
              <p className={cn("mt-1.5 text-[10.5px] font-medium", t === "ok" ? "text-ok" : "text-danger")}>{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_224px] gap-3">
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-[12px] font-semibold">Spend by month <span className="font-normal text-fg-subtle">· $ thousands</span></p>
            <div className="mt-3 flex h-[176px] items-end gap-2 border-b border-line pb-px">
              {MONTHS.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[9.5px] text-fg-subtle">{v}</span>
                  <i className={cn("m-grow-y block w-full rounded-t-[5px]", i === 11 ? "bg-linear-to-t from-[#4f46e5] to-[#818cf8]" : "bg-linear-to-t from-[#c7d2fe] to-[#e0e7ff]")} style={{ height: `${(v / 62) * 140}px`, ...at(300 + i * 60) }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9.5px] text-fg-faint">{"DJFMAMJJASON".split("").map((m, i) => <span key={i} className="flex-1 text-center">{m}</span>)}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-[12px] font-semibold">By kind of repair</p>
            <div className="relative mx-auto mt-2 h-[108px] w-[108px]">
              <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
                {SPEND.map(([k, f, c], i) => (
                  <circle key={k} cx="21" cy="21" r="15.9" fill="none" stroke={c} strokeWidth="6" strokeDasharray={`${f * 100} ${100 - f * 100}`} strokeDashoffset={-SPEND_AT[i]} className="m-rise" style={at(600 + i * 150)} />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[14px] font-semibold">$48k</span><span className="text-[9px] text-fg-subtle">November</span></div>
            </div>
            <ul className="mt-2 space-y-1">
              {SPEND.map(([k, f, c]) => <li key={k} className="flex items-center gap-1.5 text-[10.5px]"><i className="h-2 w-2 rounded-sm" style={{ background: c }} />{k}<span className="ml-auto text-fg-subtle">{Math.round(f * 100)}%</span></li>)}
            </ul>
          </div>
        </div>
      </MockWindow>
      <Float className="bottom-[20px] right-[40px]" delay={1700}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ok-soft text-ok"><BarChart3 className="h-4 w-4" /></span>
          <div><p className="font-semibold">Most costly · 2207</p><p className="text-[11px] text-fg-subtle">$0.31 per mile · turbo, injectors</p></div>
        </div>
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* AI assistant                                                        */
/* ------------------------------------------------------------------ */

export function AssistantScene() {
  return (
    <>
      <MockWindow path="assistant" active="assistant">
        <div className="mx-auto flex h-full max-w-[600px] flex-col">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-[#6366f1] to-[#a855f7] text-white"><Sparkles className="h-4 w-4" /></span>
            <div><p className="text-[14px] font-semibold">Fleet assistant</p><p className="text-[10.5px] text-fg-subtle">Answers from your own fleet data</p></div>
          </div>
          <div className="mt-4 flex-1 space-y-3">
            <div className="m-rise ml-auto w-fit max-w-[360px] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-[12.5px] text-white" style={at(200)}>
              Which trucks need an oil change this week, and where should I book them?
            </div>
            <div className="m-rise w-[470px] rounded-2xl rounded-bl-md border border-line bg-surface p-3.5 text-[12.5px] shadow-[0_1px_2px_rgba(16,24,40,0.05)]" style={at(900)}>
              <p className="m-type" style={at(1000)}>Three trucks are due by Friday. I matched each one to the shop that serviced it last:</p>
              <div className="mt-2.5 space-y-1.5">
                {[["2204", "3,412 mi over", "danger", "Keystone Truck Center · Mon 8:00"], ["2201", "420 mi over", "danger", "Rush Peterbilt · Mon 10:30"], ["2209", "1,480 mi left", "warn", "TA Truck Service · Wed"]].map(([u, s, t, shop], i) => (
                  <div key={u} className="m-rise flex items-center gap-2.5 rounded-lg bg-raised px-2.5 py-2" style={at(2000 + i * 250)}>
                    <Truck className="h-3.5 w-3.5 text-fg-subtle" /><span className="w-9 font-semibold">{u}</span><Pill tone={t as Tone}>{s}</Pill>
                    <span className="ml-auto truncate text-[11px] text-fg-muted">{shop}</span>
                  </div>
                ))}
              </div>
              <div className="m-rise mt-3 flex gap-2" style={at(2900)}><Btn>Book all 3</Btn><Btn ghost>Show on map</Btn></div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px] text-fg-faint">
            Ask about trucks, repairs, papers or costs…<span className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white"><Send className="h-3.5 w-3.5" /></span>
          </div>
        </div>
      </MockWindow>
      <Float className="bottom-[104px] right-[90px] w-[220px]" delay={3300}>
        <p className="text-[11px] text-fg-subtle">Try asking</p>
        <ul className="mt-1.5 space-y-1 text-[11.5px] font-medium">
          <li>“What did 2207 cost us this year?”</li><li>“Whose medical card expires next?”</li><li>“Which shop is the slowest?”</li>
        </ul>
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------ */

export type SceneId = "today" | "oil" | "repairs" | "inspections" | "map" | "reports" | "assistant";

export const SCENES: { id: SceneId; label: string; icon: LucideIcon; title: string; text: string; seconds: number; view: () => ReactNode }[] = [
  { id: "today", label: "Today", icon: LayoutDashboard, title: "One list of what needs a decision", text: "Overdue oil, expiring papers, late shops, open defects and missing walk-arounds, with the next action on every row.", seconds: 7, view: TodayScene },
  { id: "oil", label: "Oil changes", icon: Droplet, title: "Oil changes by odometer, not by memory", text: "Mileage comes from your ELD. FleetCore shows how much of the interval each truck has used and which are over.", seconds: 7, view: OilScene },
  { id: "repairs", label: "Repairs", icon: Wrench, title: "Every repair, from booked to back on the road", text: "Shops, promised dates, downtime and the invoice lines, with late shops flagged so nobody has to chase from memory.", seconds: 7, view: RepairsScene },
  { id: "inspections", label: "Walk-arounds", icon: ClipboardCheck, title: "Weekly walk-arounds and defects with an owner", text: "See who sent their pre-trip and who didn't. Anything wrong becomes a defect with an owner and a due date.", seconds: 7, view: InspectionsScene },
  { id: "map", label: "Live map", icon: MapPin, title: "Where every truck is, and how much fuel it has", text: "Position, speed, odometer and fuel from your ELD, for the whole fleet on one map.", seconds: 7, view: MapScene },
  { id: "reports", label: "Reports", icon: BarChart3, title: "Know what each truck costs you", text: "Spend by month, by kind of repair and by truck, cost per mile, and a CSV for the accountant.", seconds: 7, view: ReportsScene },
  { id: "assistant", label: "AI assistant", icon: Sparkles, title: "Ask your fleet a question", text: "“Which trucks are due this week?” The assistant answers from your own data and can book the work for you.", seconds: 8, view: AssistantScene },
];
