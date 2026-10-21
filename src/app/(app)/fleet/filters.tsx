"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { cn, inputClass } from "@/components/ui";
import { FilterChip, FilterField, FilterMenu } from "@/components/filter-menu";

export type FilterSelect = { name: string; placeholder: string; label?: string; options: { value: string; label: string }[] };

/**
 * Search box + compact selects that live in the URL (?q=…&ownership=…). Server filters, this only
 * rewrites the query string. Search is debounced; selects apply immediately.
 */
export function ListFilters({ basePath, params, selects = [], placeholder = "Search…", className }: {
  basePath: string;
  /** Current query params (undefined = not set). Unknown keys are preserved. */
  params: Record<string, string | undefined>;
  selects?: FilterSelect[];
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const urlQ = params.q ?? "";
  const [q, setQ] = useState(urlQ);
  // The URL can change under the box (Clear filters, a KPI tile, back / forward): show what it now says. When the change
  // is the search this box sent, keep the text instead, since the user may have typed on while it loaded.
  const [synced, setSynced] = useState({ url: urlQ, sent: urlQ });
  if (urlQ !== synced.url) {
    const external = urlQ !== synced.sent;
    setSynced({ url: urlQ, sent: external ? urlQ : synced.sent });
    if (external) setQ(urlQ);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (patch: Record<string, string | undefined>) => {
    if ("q" in patch) setSynced((s) => ({ ...s, sent: patch.q ?? "" }));
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    start(() => router.replace(`${basePath}${s ? `?${s}` : ""}`));
  };
  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || undefined }), 300);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70", className)} aria-busy={pending || undefined}>
      <label className="relative block">
        <Search className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-fg-faint" />
        <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search…" title={placeholder} aria-label={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); go({ q: q.trim() || undefined }); } }}
          className={cn(inputClass, "w-56 pl-8 pr-7")} />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => onSearch("")}
            className="absolute inset-y-0 right-1 my-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-raised hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        )}
      </label>
      {/* The selects open from one "Filters" button; whatever is applied shows as a removable chip. */}
      {selects.length > 0 && (
        <FilterMenu count={selects.filter((s) => params[s.name]).length} align="right"
          onClear={() => go(Object.fromEntries(selects.map((s) => [s.name, undefined])))}>
          {selects.map((s) => (
            <FilterField key={s.name} label={s.label ?? s.placeholder}>
              <select value={params[s.name] ?? ""} onChange={(e) => go({ [s.name]: e.target.value || undefined })} className={inputClass}>
                <option value="">{s.placeholder}</option>
                {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FilterField>
          ))}
        </FilterMenu>
      )}
      {selects.map((s) => {
        const v = params[s.name];
        return v ? <FilterChip key={s.name} onRemove={() => go({ [s.name]: undefined })}>{s.options.find((o) => o.value === v)?.label ?? v}</FilterChip> : null;
      })}
    </div>
  );
}
