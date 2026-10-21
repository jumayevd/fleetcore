"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { cn, inputClass } from "@/components/ui";

/** Debounced search for the customers list. The kind filter lives beside it as plain links; both stay in the URL. */
export function CustomerSearch({ q, kind }: { q: string; kind: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (next: string) => {
    const p = new URLSearchParams();
    if (kind && kind !== "ALL") p.set("kind", kind);
    if (next.trim()) p.set("q", next.trim());
    const s = p.toString();
    start(() => router.replace(`/customers${s ? `?${s}` : ""}`));
  };
  const onChange = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(v), 300);
  };

  return (
    <div className={cn("relative", pending && "opacity-70")} aria-busy={pending || undefined}>
      <Search className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-fg-faint" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search customers…" title="Name, contact, email, phone, city or tax ID" aria-label="Search customers and brokers"
        onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); go(value); } }}
        className={cn(inputClass, "w-64 pl-8 pr-7")} />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}
          className="absolute inset-y-0 right-1 my-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-raised hover:text-fg">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
