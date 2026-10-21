import { Search } from "lucide-react";
import { cn, inputClass } from "@/components/ui";

/**
 * Search field that submits as a plain GET (no JavaScript needed): the other filters ride along as hidden fields, and
 * the page reads `q` from the URL like any other filter.
 */
export function SearchBox({ action, q, keep = {}, placeholder = "Search", className }: {
  action: string;
  q?: string;
  /** Query parameters to keep (filters already applied). */
  keep?: Record<string, string | number | null | undefined>;
  placeholder?: string;
  className?: string;
}) {
  return (
    <form method="get" action={action} role="search" className={cn("relative", className)}>
      {Object.entries(keep).map(([k, v]) => (v == null || v === "" || k === "q" ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" aria-hidden />
      <input type="search" name="q" defaultValue={q ?? ""} placeholder={placeholder} aria-label={placeholder} className={cn(inputClass, "w-full pl-8 sm:w-64")} />
    </form>
  );
}
