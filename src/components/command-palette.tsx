"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, ArrowRight, Plus } from "lucide-react";
import { cn, Badge, Kbd } from "./ui";
import { allNavItems } from "@/lib/nav";
import { can } from "@/lib/permissions";
import type { SearchGroup } from "@/app/api/search/route";

type Item = { key: string; title: string; subtitle?: string; href: string; group: string; badge?: string; mono?: boolean; icon?: "nav" | "action" };

/** Mount this only while open — state resets naturally on every open. */
export function CommandPalette({ onClose, role }: { onClose: () => void; role: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nav = useMemo(() => allNavItems().filter((i) => can(role, i.perm)), [role]);
  const actions = useMemo<Item[]>(() => {
    const a: Item[] = [];
    if (can(role, "loads.edit")) a.push({ key: "new-load", title: "New load", subtitle: "Book a shipment", href: "/loads/new", group: "Actions", icon: "action" });
    if (can(role, "fleet.edit")) a.push({ key: "new-truck", title: "Add truck", href: "/fleet/new", group: "Actions", icon: "action" });
    if (can(role, "drivers.edit")) a.push({ key: "new-driver", title: "Add driver", href: "/drivers/new", group: "Actions", icon: "action" });
    if (can(role, "customers.edit")) a.push({ key: "new-customer", title: "Add customer", href: "/customers/new", group: "Actions", icon: "action" });
    return a;
  }, [role]);

  const search = (value: string) => {
    setQ(value);
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`, { cache: "no-store" });
        if (r.ok) setGroups((await r.json()).groups);
      } finally { setLoading(false); }
    }, 160);
  };

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const navHits = nav
      .filter((i) => !term || i.label.toLowerCase().includes(term) || i.description?.toLowerCase().includes(term))
      .map<Item>((i) => ({ key: `nav:${i.href}`, title: i.label, subtitle: i.description, href: i.href, group: "Go to", icon: "nav", badge: i.shortcut }));
    const actionHits = actions.filter((a) => !term || a.title.toLowerCase().includes(term));
    const entity = groups.flatMap((g) => g.hits.map<Item>((h) => ({ key: `${g.label}:${h.id}`, title: h.title, subtitle: h.subtitle, href: h.href, group: g.label, badge: h.badge, mono: h.mono })));
    return term ? [...entity, ...navHits.slice(0, 5), ...actionHits] : [...actionHits, ...navHits];
  }, [q, nav, actions, groups]);
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  const go = useCallback((item: Item | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  }, [onClose, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      if (e.key === "Enter") { e.preventDefault(); go(items[activeIndex]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, activeIndex, go, onClose]);

  useEffect(() => {
    document.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let lastGroup = "";
  return (
    <div className="fade-in fixed inset-0 z-[100] flex items-start justify-center bg-scrim p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose} role="dialog" aria-modal aria-label="Search">
      <div className="pop-in w-full max-w-xl overflow-hidden rounded-lg border border-line bg-overlay shadow-float [transform-origin:top_center]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
          <input autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder="Search loads, drivers, trucks, customers… or jump to a page"
            className="h-11 w-full bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-faint" aria-label="Search" />
          <Kbd>esc</Kbd>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && (
            <li className="px-3 py-8 text-center text-[13px] text-fg-subtle">{loading ? "Searching…" : q.trim().length >= 2 ? "No matches" : "Type to search"}</li>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.key}>
                {header && <p className="eyebrow px-2.5 pb-1 pt-2">{header}</p>}
                <button data-cmd-index={i} onMouseEnter={() => setActive(i)} onClick={() => go(item)} role="option" aria-selected={i === activeIndex}
                  className={cn("flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left", i === activeIndex ? "bg-raised" : "")}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-fg-subtle">
                    {item.icon === "action" ? <Plus className="h-3.5 w-3.5" /> : item.icon === "nav" ? <ArrowRight className="h-3.5 w-3.5" /> : <span className="text-[10px] font-semibold">{item.group[0]}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[13px] text-fg", item.mono && "num")}>{item.title}</span>
                    {item.subtitle && <span className="block truncate text-[11px] text-fg-subtle">{item.subtitle}</span>}
                  </span>
                  {item.badge && (item.icon === "nav"
                    ? <span className="hidden gap-0.5 sm:flex">{item.badge.split(" ").map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                    : <Badge value={item.badge.toUpperCase().replace(/ /g, "_")} label={item.badge} />)}
                  {i === activeIndex && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-fg-subtle">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span><span><Kbd>↵</Kbd> open</span><span className="ml-auto">Tip: press <Kbd>g</Kbd> then a letter to jump</span>
        </div>
      </div>
    </div>
  );
}
