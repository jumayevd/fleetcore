"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn, inputClass } from "@/components/ui";
import { FilterChip, FilterField, FilterMenu } from "@/components/filter-menu";

export type SelectFilter = { name: string; label: string; options: { value: string; label: string }[]; allLabel?: string };
export type ToggleFilter = { name: string; label: string; on?: string; title?: string; icon?: ReactNode };

/**
 * Search box, quick toggles and a "Filters" menu that all live in the URL. Search is debounced; everything else applies
 * at once. `keep` lists query keys that survive "Clear all" (the status pill, the week).
 */
export function ListFilters({ search, selects = [], toggles = [], keep = [] }: {
  search?: { placeholder: string; title?: string };
  selects?: SelectFilter[];
  toggles?: ToggleFilter[];
  keep?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    // A highlighted defect or an open form belongs to the old view.
    p.delete("defect"); p.delete("new");
    const s = p.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };
  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || null }), 300);
  };
  const clearAll = () => {
    setQ("");
    if (timer.current) clearTimeout(timer.current);
    const p = new URLSearchParams();
    for (const k of keep) { const v = sp.get(k); if (v) p.set(k, v); }
    const s = p.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  const applied = selects.filter((f) => sp.get(f.name));
  const anyFilter = Boolean(sp.get("q")) || applied.length > 0 || toggles.some((t) => sp.get(t.name));
  const chip = (on: boolean) => cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
    on ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line bg-surface text-fg-muted shadow-card hover:border-line-strong hover:text-fg",
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")} aria-busy={pending || undefined}>
      {search && (
        <div className="relative">
          <Search className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-fg-faint" />
          <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder={search.placeholder} title={search.title} aria-label={search.placeholder}
            onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); go({ q: q.trim() || null }); } }}
            className={cn(inputClass, "w-56 pl-8 pr-7")} />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => onSearch("")}
              className="absolute inset-y-0 right-1 my-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-raised hover:text-fg">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {toggles.length > 0 && (
        <div role="group" aria-label="Quick filters" className="flex flex-wrap items-center gap-1.5">
          {toggles.map((t) => {
            const value = t.on ?? "1";
            const on = sp.get(t.name) === value;
            return (
              <button key={t.name} type="button" aria-pressed={on} title={t.title} onClick={() => go({ [t.name]: on ? null : value })} className={chip(on)}>
                {t.icon}{t.label}{on && <X className="-mr-1 text-accent-text" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
      {selects.length > 0 && (
        <FilterMenu count={applied.length} onClear={() => go(Object.fromEntries(selects.map((s) => [s.name, null])))}>
          {selects.map((f) => (
            <FilterField key={f.name} label={f.label}>
              <select value={sp.get(f.name) ?? ""} onChange={(e) => go({ [f.name]: e.target.value || null })} className={inputClass}>
                <option value="">{f.allLabel ?? "All"}</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FilterField>
          ))}
        </FilterMenu>
      )}
      {applied.map((f) => (
        <FilterChip key={f.name} onRemove={() => go({ [f.name]: null })}>
          <span className="text-fg-subtle">{f.label}:</span>&nbsp;{f.options.find((o) => o.value === sp.get(f.name))?.label ?? sp.get(f.name)}
        </FilterChip>
      ))}
      {anyFilter && (
        <button type="button" onClick={clearAll} className="h-8 rounded-md px-2 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">Clear all</button>
      )}
    </div>
  );
}
