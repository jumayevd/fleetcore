"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Check, MonitorSmartphone, Moon, Sun } from "lucide-react";
import { cn } from "./ui";
import { useThemePref, writePref } from "./theme-toggle";
import {
  ACCENTS, ACCENT_SWATCH, DENSITIES, FONTS, FONT_LABEL, saveAppearance, type Accent, type Density, type FontChoice, type ThemePref,
} from "@/lib/theme";

// The accent / density / font live as attributes on <html> (set by the server from cookies). A tiny store over
// those attributes keeps every control in sync, including the menu and the account page at the same time.
const attrListeners = new Set<() => void>();
let attrObserver: MutationObserver | null = null;
function subscribeAttrs(cb: () => void) {
  attrListeners.add(cb);
  if (!attrObserver) {
    attrObserver = new MutationObserver(() => attrListeners.forEach((l) => l()));
    attrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent", "data-density", "data-font"] });
  }
  return () => {
    attrListeners.delete(cb);
    if (attrListeners.size === 0) { attrObserver?.disconnect(); attrObserver = null; }
  };
}
function useHtmlAttr<T extends string>(name: string, fallback: T): T {
  return useSyncExternalStore(subscribeAttrs, () => (document.documentElement.getAttribute(`data-${name}`) as T | null) ?? fallback, () => fallback);
}

const THEMES: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Day", icon: Sun },
  { key: "dark", label: "Night", icon: Moon },
  { key: "auto", label: "Auto", icon: MonitorSmartphone },
];
const DENSITY_LABEL: Record<Density, string> = { compact: "Compact", default: "Default", comfortable: "Roomy" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-fg-muted">{label}</p>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { key: T; label: string; icon?: typeof Sun }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-sunken p-1">
      {options.map((o) => {
        const on = o.key === value;
        const Icon = o.icon;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.key)}
            className={cn("inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-[color,background-color,box-shadow] duration-150",
              on ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg")}>
            {Icon && <Icon className="h-3.5 w-3.5" />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Personal look of the app, saved in this browser and applied instantly: theme, accent colour, density, font
 * and (in the app shell) the sidebar. Used by the top-bar Appearance menu and the My account page.
 */
export function AppearanceControls({ sidebarOpen, onSidebar }: { sidebarOpen?: boolean; onSidebar?: (open: boolean) => void }) {
  const theme = useThemePref();
  const accent = useHtmlAttr<Accent>("accent", "blue");
  const density = useHtmlAttr<Density>("density", "default");
  const font = useHtmlAttr<FontChoice>("font", "inter");

  return (
    <div className="space-y-4">
      <Row label="Theme">
        <Segmented label="Theme" value={theme} options={THEMES} onChange={writePref} />
      </Row>
      <Row label="Accent colour">
        <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={a === accent} aria-label={a} title={a[0].toUpperCase() + a.slice(1)}
              onClick={() => saveAppearance("accent", a)}
              className={cn("flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-overlay transition-transform duration-150 hover:scale-110",
                a === accent && "ring-2 ring-fg/25")}
              style={{ background: ACCENT_SWATCH[a] }}>
              {a === accent && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Density">
        <Segmented label="Density" value={density} options={DENSITIES.map((d) => ({ key: d, label: DENSITY_LABEL[d] }))} onChange={(d) => saveAppearance("density", d)} />
      </Row>
      <Row label="Font">
        <Segmented label="Font" value={font} options={FONTS.map((f) => ({ key: f, label: FONT_LABEL[f] }))} onChange={(f) => saveAppearance("font", f)} />
      </Row>
      {onSidebar && (
        <Row label="Sidebar">
          <Segmented label="Sidebar" value={sidebarOpen ? "open" : "rail"}
            options={[{ key: "open", label: "With labels" }, { key: "rail", label: "Icons only" }]} onChange={(v) => onSidebar(v === "open")} />
        </Row>
      )}
    </div>
  );
}
