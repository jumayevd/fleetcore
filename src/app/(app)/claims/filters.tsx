"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { CLAIM_FAULTS, CLAIM_FAULT_LABELS, CLAIM_SEVERITIES, CLAIM_STATUSES, CLAIM_TYPES, CLAIM_TYPE_LABELS } from "@/lib/constants";
import { cn, inputClass } from "@/components/ui";
import { FilterChip, FilterField, FilterMenu } from "@/components/filter-menu";
import { CLAIM_SEVERITY_LABELS, CLAIM_STATUS_LABELS, STATUS_GROUPS, claimPhase, claimsHref, type ClaimFilters, type ClaimPhase } from "./shared";

/** Statuses the pill row beside this bar already shows as selected; anything else counts as a menu filter. */
const PILL_STATUSES: readonly string[] = [...STATUS_GROUPS, "APPROVED"];

/**
 * Filter bar. Everything lives in the URL (shareable, back-button friendly): selects apply
 * immediately, search is debounced and also applies on Enter. The server does the filtering.
 * Search stays in view; type, status, severity and fault live behind one "Filters" button,
 * and whatever is applied shows as a chip you can remove.
 */
export function ClaimFilterBar({ values }: { values: ClaimFilters }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(values.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Searches this box pushed that the URL has not caught up with yet, oldest first.
  const [sent, setSent] = useState<string[]>([]);
  const [urlQ, setUrlQ] = useState(values.q);
  if (values.q !== urlQ) {
    // The URL's search changed. Our own push arriving must not overwrite typing that continued after
    // it; anything else (back / forward, a link that drops the search) is shown in the box.
    setUrlQ(values.q);
    const i = sent.indexOf(values.q);
    if (i >= 0) setSent(sent.slice(i + 1));
    else { setSent([]); setQ(values.q); }
  }

  const go = (patch: Partial<Record<keyof ClaimFilters, string | undefined>>) => {
    start(() => router.replace(claimsHref(values, patch)));
  };
  const search = (v: string) => {
    const next = v.trim();
    if (next !== values.q) setSent((xs) => [...xs, next]);
    go({ q: next || undefined });
  };
  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(v), 300);
  };
  const inPhase = (phase: ClaimPhase) => CLAIM_STATUSES.filter((s) => claimPhase(s) === phase);
  // A lifecycle status picked here is shown by the pill row, so it counts on the button but gets no chip.
  const specificStatus = values.status && !PILL_STATUSES.includes(values.status) ? values.status : undefined;
  const count = [values.type, specificStatus, values.severity, values.fault].filter(Boolean).length;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")} aria-busy={pending || undefined}>
      <label className="relative block">
        <Search className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-fg-faint" />
        <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search claims…" title="Number, load, driver, unit or location" aria-label="Search claims"
          onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); search(q); } }}
          className={cn(inputClass, "w-60 pl-8 pr-7")} />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => onSearch("")}
            className="absolute inset-y-0 right-1 my-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-raised hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        )}
      </label>

      <FilterMenu count={count} onClear={() => go({ type: undefined, status: undefined, severity: undefined, fault: undefined })}>
        <FilterField label="Claim type">
          <select value={values.type ?? ""} onChange={(e) => go({ type: e.target.value || undefined })} className={inputClass}>
            <option value="">All types</option>
            {CLAIM_TYPES.map((t) => <option key={t} value={t}>{CLAIM_TYPE_LABELS[t]}</option>)}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select value={values.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })} className={inputClass}>
            <option value="">All statuses</option>
            <option value="open">Open (any)</option>
            <option value="closed">Closed (any)</option>
            <optgroup label="Open">{inPhase("open").map((s) => <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>)}</optgroup>
            <optgroup label="Awaiting payment">{inPhase("awaiting").map((s) => <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>)}</optgroup>
            <optgroup label="Closed">{inPhase("closed").map((s) => <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>)}</optgroup>
          </select>
        </FilterField>
        <FilterField label="Severity">
          <select value={values.severity ?? ""} onChange={(e) => go({ severity: e.target.value || undefined })} className={inputClass}>
            <option value="">All severities</option>
            {CLAIM_SEVERITIES.map((s) => <option key={s} value={s}>{CLAIM_SEVERITY_LABELS[s] ?? s}</option>)}
          </select>
        </FilterField>
        <FilterField label="Fault">
          <select value={values.fault ?? ""} onChange={(e) => go({ fault: e.target.value || undefined })} className={inputClass}>
            <option value="">Any fault</option>
            {CLAIM_FAULTS.map((f) => <option key={f} value={f}>{CLAIM_FAULT_LABELS[f]}</option>)}
          </select>
        </FilterField>
      </FilterMenu>

      {values.type && <FilterChip onRemove={() => go({ type: undefined })}>{CLAIM_TYPE_LABELS[values.type] ?? values.type}</FilterChip>}
      {values.severity && <FilterChip onRemove={() => go({ severity: undefined })}>{CLAIM_SEVERITY_LABELS[values.severity] ?? values.severity} severity</FilterChip>}
      {values.fault && <FilterChip onRemove={() => go({ fault: undefined })}>Fault: {(CLAIM_FAULT_LABELS[values.fault] ?? values.fault).toLowerCase()}</FilterChip>}
    </div>
  );
}
