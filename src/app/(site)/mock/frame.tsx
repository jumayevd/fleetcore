import type { CSSProperties, ReactNode } from "react";
import {
  BarChart3, Bell, ClipboardCheck, LayoutDashboard, Lock, MapPin, Search, Sparkles, Truck, Users, Wrench, type LucideIcon,
} from "lucide-react";
import { Wordmark } from "@/components/brand";
import { cn } from "@/components/ui";

/*
 * Product mock-ups for the public site: the FleetCore app drawn in HTML (always in the Day palette, .mock-light) so the
 * site shows it bright, sharp at any size and moving, instead of flat screenshots. Each scene is laid out on a fixed
 * W×H canvas and MockStage scales it to fit. Data is made up, like the live demo's.
 */

/** Scene canvas, in px. The app window sits inside it with room around it for floating cards. */
export const W = 1000;
export const H = 660;

/** Stagger an entrance animation. */
export const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export type MockNav = "today" | "fleet" | "maintenance" | "inspections" | "drivers" | "tracking" | "reports" | "assistant";

const NAV: [MockNav, string, LucideIcon][] = [
  ["today", "Today", LayoutDashboard], ["fleet", "Fleet", Truck], ["maintenance", "Maintenance", Wrench],
  ["inspections", "Inspections", ClipboardCheck], ["drivers", "Drivers", Users], ["tracking", "Tracking", MapPin],
  ["reports", "Reports", BarChart3], ["assistant", "Assistant", Sparkles],
];

/** The app window: browser bar, sidebar, top bar and the page. */
export function MockWindow({ path, active, children, flush }: { path: string; active: MockNav; children: ReactNode; flush?: boolean }) {
  return (
    <div className="mock-light absolute left-[30px] top-[30px] flex h-[600px] w-[940px] flex-col overflow-hidden rounded-[16px] bg-canvas text-[13px] shadow-[0_40px_80px_-24px_rgba(30,41,110,0.45),0_0_0_1px_rgba(16,24,40,0.08)]">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <span className="flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></span>
        <span className="mx-auto flex h-6 w-[340px] items-center justify-center gap-1.5 rounded-md bg-sunken text-[11px] text-fg-subtle">
          <Lock className="h-3 w-3" />www.fleet-core.uz/{path}
        </span>
        <span className="w-[46px]" />
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[176px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4">
          <Wordmark className="ml-1.5 h-[19px]" />
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#0ea5e9] text-[9px] font-bold text-white">DF</span>
            <span className="truncate text-[12px] font-medium">Demo Freight Co.</span>
          </div>
          <nav className="mt-4 space-y-0.5">
            {NAV.map(([id, label, Icon]) => (
              <div key={id} className={cn("flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[12.5px]", id === active ? "bg-accent-soft font-medium text-accent-text" : "text-fg-muted")}>
                <Icon className="h-[15px] w-[15px]" />{label}
                {id === "today" && <span className="ml-auto rounded-full bg-danger px-1.5 text-[10px] font-semibold leading-4 text-white">14</span>}
              </div>
            ))}
          </nav>
          <p className="mt-auto pl-2 text-[10px] text-fg-faint">© 2026 · by Kaizen</p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
            <span className="flex h-8 w-[260px] items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-[12px] text-fg-faint"><Search className="h-3.5 w-3.5" />Search trucks, drivers, repairs…</span>
            <span className="ml-auto flex items-center gap-1.5 rounded-md bg-progress-soft px-2.5 py-1.5 text-[12px] font-medium text-progress"><Sparkles className="h-3.5 w-3.5" />Assistant</span>
            <span className="relative"><Bell className="h-4 w-4 text-fg-muted" /><i className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" /></span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br from-[#6366f1] to-[#a855f7] text-[10px] font-semibold text-white">AK</span>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-hidden", !flush && "p-5")}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export type Tone = "ok" | "warn" | "danger" | "info" | "progress" | "neutral" | "accent";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", danger: "bg-danger-soft text-danger", info: "bg-info-soft text-info",
  progress: "bg-progress-soft text-progress", neutral: "bg-neutral-soft text-fg-muted", accent: "bg-accent-soft text-accent-text",
};
export const toneBg = (t: Tone) => TONE[t];
const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info", progress: "bg-progress", neutral: "bg-fg-faint", accent: "bg-accent" };
export const toneDot = (t: Tone) => DOT[t];

export function Pill({ tone, children, dot, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[2px] text-[11px] font-medium", TONE[tone], className)}>
      {dot && <i className="h-1.5 w-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

/** A card floating over the window's edge: pops in, then bobs gently. */
export function Float({ className, delay = 900, children }: { className: string; delay?: number; children: ReactNode }) {
  return (
    <div className={cn("mock-light absolute z-10", className)}>
      <div className="m-pop" style={at(delay)}>
        <div className="m-float rounded-xl bg-surface px-3.5 py-3 text-[12px] shadow-[0_18px_40px_-12px_rgba(30,41,110,0.4),0_0_0_1px_rgba(16,24,40,0.06)]" style={at(delay % 1700)}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h3 className="text-[19px] font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="mt-0.5 text-[12px] text-fg-subtle">{sub}</p>
      </div>
      {action}
    </div>
  );
}

export function Btn({ children, ghost }: { children: ReactNode; ghost?: boolean }) {
  return (
    <span className={cn("inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12px] font-medium",
      ghost ? "border border-line bg-surface text-fg" : "bg-accent text-white shadow-[0_1px_2px_rgba(37,99,235,0.4)]")}>
      {children}
    </span>
  );
}
