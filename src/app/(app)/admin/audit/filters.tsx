"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { cn, inputClass } from "@/components/ui";
import { FilterChip, FilterField, FilterMenu } from "@/components/filter-menu";
import { date } from "@/lib/format";
import { auditHref, isoDay, type AuditFilterParams } from "./shared";

type Opt = { value: string; label: string; count?: number };
type DateKey = "from" | "to";

const SYSTEM = { value: "system", label: "System (automatic)" };

/**
 * Filter bar for the audit log: a search box, then person, action and dates behind one "Filters" button, with
 * whatever is applied shown as removable chips. Everything lives in the URL: selects and dates apply at once,
 * the search box is debounced. The server does the filtering and the paging.
 */
export function AuditFilters({ params, users, actions }: { params: AuditFilterParams; users: Opt[]; actions: Opt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Typed dates pass through half-finished values (year 0002, 0020, 0202…). Keep what is typed locally and
  // apply only a complete, real date or a full clear; when the URL's value for a field changes, show that.
  const [dates, setDates] = useState({ from: params.from ?? "", to: params.to ?? "" });
  const [shown, setShown] = useState({ from: params.from, to: params.to });
  if (shown.from !== params.from || shown.to !== params.to) {
    setShown({ from: params.from, to: params.to });
    setDates((d) => ({
      from: shown.from !== params.from ? params.from ?? "" : d.from,
      to: shown.to !== params.to ? params.to ?? "" : d.to,
    }));
  }

  const go = (patch: Partial<AuditFilterParams>) => start(() => router.replace(auditHref(params, patch)));
  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || undefined }), 300);
  };
  const onDate = (key: DateKey, input: HTMLInputElement) => {
    const v = input.value;
    setDates((d) => ({ ...d, [key]: v }));
    // An empty value with badInput is a partly cleared field, not a cleared filter.
    if (v ? isoDay(v) && v !== params[key] : !input.validity.badInput && params[key]) go({ [key]: v || undefined });
  };
  // Clears the menu's filters (person, action, dates); the search box and the entity pills have their own controls.
  const clearMenu = () => {
    // A pending search must not re-apply the old filters: send what is typed along with the clear.
    if (timer.current) clearTimeout(timer.current);
    setDates({ from: "", to: "" });
    go({ user: undefined, action: undefined, from: undefined, to: undefined, q: q.trim() || undefined });
  };
  const count = [params.user, params.action, params.from || params.to].filter(Boolean).length;
  const userLabel = params.user ? ([...users, SYSTEM].find((u) => u.value === params.user)?.label ?? "Unknown user") : null;
  const actionLabel = params.action ? (actions.find((a) => a.value === params.action)?.label ?? params.action) : null;
  const dateInput = cn(inputClass, "num");

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")} aria-busy={pending || undefined}>
      <label className="relative block">
        <Search className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-fg-faint" />
        <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search details…" aria-label="Search details"
          onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); go({ q: q.trim() || undefined }); } }}
          className={cn(inputClass, "w-56 pl-8 pr-7")} />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => onSearch("")}
            className="absolute inset-y-0 right-1 my-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-raised hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        )}
      </label>

      <FilterMenu count={count} onClear={clearMenu}>
        <FilterField label="Person">
          <select value={params.user ?? ""} onChange={(e) => go({ user: e.target.value || undefined })} className={inputClass}>
            <option value="">Everyone</option>
            {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            <option value={SYSTEM.value}>{SYSTEM.label}</option>
          </select>
        </FilterField>
        <FilterField label="Action">
          <select value={params.action ?? ""} onChange={(e) => go({ action: e.target.value || undefined })} className={inputClass}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a.value} value={a.value}>{a.label}{a.count != null ? ` (${a.count})` : ""}</option>)}
          </select>
        </FilterField>
        <div className="grid grid-cols-2 gap-2">
          <FilterField label="From">
            <input type="date" value={dates.from} max={params.to || undefined} onChange={(e) => onDate("from", e.currentTarget)} className={dateInput} />
          </FilterField>
          <FilterField label="To">
            <input type="date" value={dates.to} min={params.from || undefined} onChange={(e) => onDate("to", e.currentTarget)} className={dateInput} />
          </FilterField>
        </div>
      </FilterMenu>

      {userLabel && <FilterChip onRemove={() => go({ user: undefined })}>{userLabel}</FilterChip>}
      {actionLabel && <FilterChip onRemove={() => go({ action: undefined })}>{actionLabel}</FilterChip>}
      {(params.from || params.to) && (
        <FilterChip onRemove={() => { setDates({ from: "", to: "" }); go({ from: undefined, to: undefined }); }}>
          <span className="num">{params.from ? date(`${params.from}T00:00:00`) : "…"} – {params.to ? date(`${params.to}T00:00:00`) : "…"}</span>
        </FilterChip>
      )}
    </div>
  );
}
