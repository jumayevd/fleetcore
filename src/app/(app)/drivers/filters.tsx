"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Eye, FileWarning, PauseCircle, Search, ShieldAlert, Truck, X } from "lucide-react";
import { cn, inputClass } from "@/components/ui";
import { FilterChip, FilterField, FilterMenu } from "@/components/filter-menu";

export type DriverFilterParams = {
  q?: string; type?: string; status?: string; inactive?: string;
  atRisk?: string; papers?: string; hold?: string; truck?: string; dispatcher?: string;
};
type Opt = { value: string; label: string };
type Toggle = "atRisk" | "papers" | "hold" | "truck";

/** Quick filters, always in view as chips (a fleet specialist's usual questions). */
const QUICK: { key: Toggle; on: string; label: string; icon: ReactNode; title: string }[] = [
  { key: "atRisk", on: "1", label: "At risk", icon: <ShieldAlert />, title: "Safety score under 75, or licence / medical expired or expiring within 30 days" },
  { key: "papers", on: "1", label: "Papers due", icon: <FileWarning />, title: "Licence or medical certificate expired or expiring within 30 days" },
  { key: "hold", on: "1", label: "On hold", icon: <PauseCircle />, title: "Kept off the road until released" },
  { key: "truck", on: "none", label: "No truck", icon: <Truck />, title: "Drivers without an assigned truck" },
];

/**
 * Filter bar for the drivers roster. Everything lives in the URL: chips and selects apply immediately, search is
 * debounced. The server does the filtering.
 */
export function DriverFilters({ params, types, statuses, dispatchers = [] }: { params: DriverFilterParams; types: Opt[]; statuses: Opt[]; dispatchers?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (patch: Partial<DriverFilterParams>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    start(() => router.replace(`/drivers${s ? `?${s}` : ""}`, { scroll: false }));
  };
  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || undefined }), 300);
  };
  const clearAll = () => {
    setQ("");
    if (timer.current) clearTimeout(timer.current);
    start(() => router.replace("/drivers", { scroll: false }));
  };

  const menuCount = [params.type, params.status, params.inactive, params.dispatcher].filter(Boolean).length;
  const anyFilter = Object.values(params).some(Boolean);
  const label = (list: Opt[], v?: string) => list.find((o) => o.value === v)?.label ?? v;
  const chip = (on: boolean) => cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
    on ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line bg-surface text-fg-muted shadow-card hover:border-line-strong hover:text-fg",
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")} aria-busy={pending || undefined}>
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-fg-faint" />
        <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search drivers…" title="Name, phone, email, licence number, dispatcher, truck or plate" aria-label="Search drivers"
          onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); go({ q: q.trim() || undefined }); } }}
          className={cn(inputClass, "w-60 pl-8 pr-7")} />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => onSearch("")}
            className="absolute inset-y-0 right-1 my-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-raised hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div role="group" aria-label="Quick filters" className="flex flex-wrap items-center gap-1.5">
        {QUICK.map((c) => {
          const on = params[c.key] === c.on;
          return (
            <button key={c.key} type="button" aria-pressed={on} title={c.title} onClick={() => go({ [c.key]: on ? undefined : c.on })} className={chip(on)}>
              {c.icon}{c.label}{on && <X className="-mr-1 text-accent-text" aria-hidden />}
            </button>
          );
        })}
      </div>

      <FilterMenu count={menuCount} label="More filters" onClear={() => go({ type: undefined, status: undefined, inactive: undefined, dispatcher: undefined })}>
        {dispatchers.length > 0 && (
          <FilterField label="Dispatcher">
            <select value={params.dispatcher ?? ""} onChange={(e) => go({ dispatcher: e.target.value || undefined })} className={inputClass}>
              <option value="">Any dispatcher</option>
              <option value="none">No dispatcher set</option>
              {dispatchers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </FilterField>
        )}
        <FilterField label="Driver type">
          <select value={params.type ?? ""} onChange={(e) => go({ type: e.target.value || undefined })} className={inputClass}>
            <option value="">All types</option>
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </FilterField>
        <FilterField label="Employment">
          <select value={params.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })} className={inputClass}>
            <option value="">Active and on leave</option>
            {statuses.map((t) => <option key={t.value} value={t.value}>{t.label} only</option>)}
          </select>
        </FilterField>
        {!params.status && (
          <div className="pt-1">
            <button type="button" aria-pressed={Boolean(params.inactive)} onClick={() => go({ inactive: params.inactive ? undefined : "1" })} className={chip(Boolean(params.inactive))}
              title="Include drivers who no longer work here">
              <Eye />Show inactive too
            </button>
          </div>
        )}
      </FilterMenu>

      {params.dispatcher && <FilterChip onRemove={() => go({ dispatcher: undefined })}>{params.dispatcher === "none" ? "No dispatcher" : `Dispatch: ${params.dispatcher}`}</FilterChip>}
      {params.type && <FilterChip onRemove={() => go({ type: undefined })}>{label(types, params.type)}</FilterChip>}
      {params.status && <FilterChip onRemove={() => go({ status: undefined })}>{label(statuses, params.status)} only</FilterChip>}
      {params.inactive && !params.status && <FilterChip onRemove={() => go({ inactive: undefined })}>Inactive shown</FilterChip>}
      {anyFilter && (
        <button type="button" onClick={clearAll} className="h-8 rounded-md px-2 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">Clear all</button>
      )}
    </div>
  );
}
