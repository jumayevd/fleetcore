"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui";
import { FilterChip, FilterField, FilterMenu } from "@/components/filter-menu";

export type FilterDef = {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder?: string;
};

/**
 * URL-bound select filters behind one "Filters" button: changing one updates the query string in place (no submit
 * button), and whatever is applied shows as a removable chip.
 */
export function FilterBar({ filters, keep = [], align = "left" }: {
  filters: FilterDef[];
  /** Query keys to preserve when clearing (tab, period). */
  keep?: string[];
  /** Which edge of the button the popover lines up with. */
  align?: "left" | "right";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const replace = (p: URLSearchParams) => {
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const set = (name: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(name, value); else p.delete(name);
    replace(p);
  };
  const clear = () => {
    const p = new URLSearchParams();
    for (const k of keep) { const v = sp.get(k); if (v) p.set(k, v); }
    replace(p);
  };
  const applied = filters.filter((f) => f.value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterMenu count={applied.length} onClear={clear} align={align}>
        {filters.map((f) => (
          <FilterField key={f.name} label={f.label}>
            <Select name={f.name} value={f.value} onChange={(e) => set(f.name, e.target.value)} options={f.options} placeholder={f.placeholder ?? "All"} />
          </FilterField>
        ))}
      </FilterMenu>
      {applied.map((f) => (
        <FilterChip key={f.name} onRemove={() => set(f.name, "")}>
          <span className="text-fg-subtle">{f.label}:</span>&nbsp;{f.options.find((o) => o.value === f.value)?.label ?? f.value}
        </FilterChip>
      ))}
    </div>
  );
}
