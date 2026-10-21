"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, ShieldAlert, X, Eye } from "lucide-react";
import { cn, inputClass } from "@/components/ui";
import { FilterChip, FilterField, FilterMenu } from "@/components/filter-menu";

export type DriverFilterParams = { team?: string; type?: string; status?: string; atRisk?: string; inactive?: string; hold?: string; q?: string };
type Opt = { value: string; label: string };

/**
 * Filter bar for the drivers roster. Everything lives in the URL: selects and toggles apply
 * immediately, search is debounced. The server does the filtering.
 */
export function DriverFilters({ params, teams, types, statuses }: {
  params: DriverFilterParams; teams: Opt[]; types: Opt[]; statuses: Opt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (patch: Partial<DriverFilterParams>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    start(() => router.replace(`/drivers${s ? `?${s}` : ""}`));
  };
  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || undefined }), 300);
  };
  const toggle = (key: "atRisk" | "inactive") => go({ [key]: params[key] ? undefined : "1" });
  // Search stays in view; team, type, status and the two switches live behind one "Filters" button.
  const count = [params.team, params.type, params.status, params.atRisk, params.inactive].filter(Boolean).length;
  const label = (list: Opt[], v?: string) => (v === "none" ? "No team" : list.find((o) => o.value === v)?.label ?? v);
  const pill = (on: boolean) => cn(
    "inline-flex h-8 items-center gap-1.5 rounded-[9px] border px-2.5 text-[12px] font-medium transition-colors",
    on ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg",
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")} aria-busy={pending || undefined}>
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-fg-faint" />
        <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search drivers…" title="Name, phone, licence or truck" aria-label="Search drivers"
          onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); go({ q: q.trim() || undefined }); } }}
          className={cn(inputClass, "w-60 pl-8 pr-7")} />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => onSearch("")}
            className="absolute inset-y-0 right-1 my-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-raised hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <FilterMenu count={count} onClear={() => go({ team: undefined, type: undefined, status: undefined, atRisk: undefined, inactive: undefined })}>
        <FilterField label="Team">
          <select value={params.team ?? ""} onChange={(e) => go({ team: e.target.value || undefined })} className={inputClass}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            <option value="none">No team</option>
          </select>
        </FilterField>
        <FilterField label="Driver type">
          <select value={params.type ?? ""} onChange={(e) => go({ type: e.target.value || undefined })} className={inputClass}>
            <option value="">All types</option>
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </FilterField>
        <FilterField label="Employment">
          <select value={params.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })} className={inputClass}>
            <option value="">All statuses</option>
            {statuses.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </FilterField>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" aria-pressed={Boolean(params.atRisk)} onClick={() => toggle("atRisk")} className={pill(Boolean(params.atRisk))}
            title="Score under 75, or licence / medical expired or expiring within 30 days">
            <ShieldAlert className="h-3.5 w-3.5" />At risk only
          </button>
          <button type="button" aria-pressed={Boolean(params.inactive)} onClick={() => toggle("inactive")} className={pill(Boolean(params.inactive))}
            title="Include drivers who no longer work here">
            <Eye className="h-3.5 w-3.5" />Show inactive
          </button>
        </div>
      </FilterMenu>

      {params.team && <FilterChip onRemove={() => go({ team: undefined })}>{label(teams, params.team)}</FilterChip>}
      {params.type && <FilterChip onRemove={() => go({ type: undefined })}>{label(types, params.type)}</FilterChip>}
      {params.status && <FilterChip onRemove={() => go({ status: undefined })}>{label(statuses, params.status)}</FilterChip>}
      {params.atRisk && <FilterChip onRemove={() => toggle("atRisk")}>At risk</FilterChip>}
      {params.inactive && <FilterChip onRemove={() => toggle("inactive")}>Inactive shown</FilterChip>}
      {params.hold && <FilterChip onRemove={() => go({ hold: undefined })}>On hold</FilterChip>}
    </div>
  );
}
