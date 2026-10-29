"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardCheck, Droplet, FileWarning, Search, Truck, Users, Wrench, X, type LucideIcon } from "lucide-react";
import { Chip, IconTile, LinkButton, StatusDot, buttonClass, cardClass, cn, inputClass, segmentedThumb, segmentedTrack, type Hue } from "@/components/ui";
import {
  DECISION_CATEGORIES, DECISION_CATEGORY_HINTS, DECISION_CATEGORY_LABELS, DECISION_PRIORITY_HINTS, DECISION_PRIORITY_LABELS,
  DECISION_PRIORITY_TONE, type Decision, type DecisionCategory,
} from "./decision-types";

const CATEGORY_ICON: Record<DecisionCategory, LucideIcon> = { oil: Droplet, shop: Wrench, documents: FileWarning, pti: ClipboardCheck, drivers: Users, fleet: Truck };
const CATEGORY_HUE: Record<DecisionCategory, Hue> = { oil: "hue-4", shop: "hue-2", documents: "hue-1", pti: "hue-3", drivers: "hue-5", fleet: "hue-6" };
/** The five every fleet has; "Fleet" (no driver, lease cap, silent trackers) only shows up when it has something. */
const ALWAYS: DecisionCategory[] = ["oil", "shop", "documents", "pti", "drivers"];

type Cat = "all" | DecisionCategory;

/**
 * "Needs a decision today": every open item, worst and oldest first, each with the one button that sorts it. Category
 * chips and a search box narrow it down; it pages so the card keeps its height. Rows arrive filtered to what this role
 * can open; view-only members get a link to the record instead of the action.
 */
export function DecisionsTable({ rows, canEdit, initialCategory = "all", pageSize = 10, title = "Needs a decision today", id = "decisions" }: {
  rows: Decision[];
  canEdit: boolean;
  initialCategory?: Cat;
  pageSize?: number;
  title?: string;
  id?: string;
}) {
  const [cat, setCat] = useState<Cat>(initialCategory);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const headingId = useId();

  const haystacks = useMemo(() => new Map(rows.map((r) => [r.key, [r.unit?.label, r.driver?.name, r.issue, r.detail, DECISION_CATEGORY_LABELS[r.category]].filter(Boolean).join(" ").toLowerCase()])), [rows]);
  const needle = q.trim().toLowerCase();
  const searched = useMemo(() => (needle ? rows.filter((r) => haystacks.get(r.key)!.includes(needle)) : rows), [rows, haystacks, needle]);
  const shown = cat === "all" ? searched : searched.filter((r) => r.category === cat);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * pageSize, current * pageSize + pageSize);
  const now = rows.filter((r) => r.priority === "urgent").length;

  const counts = useMemo(() => {
    const m = new Map<DecisionCategory, number>();
    for (const r of searched) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [searched]);
  const chips: Cat[] = ["all", ...DECISION_CATEGORIES.filter((c) => ALWAYS.includes(c) || (counts.get(c) ?? 0) > 0 || c === cat)];

  const choose = (c: Cat) => {
    setCat(c);
    setPage(0);
    // The category stays in the address, so a refresh or a shared link opens the same view.
    try {
      const url = new URL(window.location.href);
      if (c === "all") url.searchParams.delete("cat"); else url.searchParams.set("cat", c);
      window.history.replaceState(null, "", url);
    } catch { /* address bar is a nicety */ }
  };
  const search = (v: string) => { setQ(v); setPage(0); };

  return (
    <section id={id} aria-labelledby={headingId} className={cn(cardClass, "flex min-w-0 scroll-mt-20 flex-col")}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-2 pt-3">
        <h2 id={headingId} className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          {title}
          {rows.length > 0 && <span className="num rounded-full bg-neutral-soft px-1.5 text-[11px] font-medium leading-5 text-fg-muted">{rows.length}</span>}
          {now > 0 && <span className="num rounded-full bg-danger-soft px-1.5 text-[11px] font-medium leading-5 text-danger" title={DECISION_PRIORITY_HINTS.urgent}>{now} now</span>}
        </h2>
        {rows.length > 0 && (
          <div className="relative w-full sm:w-60">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-faint" />
            <input value={q} onChange={(e) => search(e.target.value)} placeholder="Unit, driver or issue" aria-label="Search decisions"
              className={cn(inputClass, "pl-8 pr-8")} />
            {q && (
              <button type="button" onClick={() => search("")} aria-label="Clear search" className="absolute right-1.5 top-1.5 rounded p-0.5 text-fg-subtle hover:bg-raised hover:text-fg"><X className="h-4 w-4" /></button>
            )}
          </div>
        )}
      </header>

      {rows.length > 0 && (
        <div className="px-4 pb-2.5">
          <div role="group" aria-label="Category" className={segmentedTrack}>
            {chips.map((c) => {
              const on = c === cat;
              const n = c === "all" ? searched.length : counts.get(c) ?? 0;
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => choose(c)} title={c === "all" ? undefined : DECISION_CATEGORY_HINTS[c]}
                  className={segmentedThumb(on)}>
                  {c === "all" ? "All" : DECISION_CATEGORY_LABELS[c]}
                  <span className={cn("num text-[10.5px]", on ? "text-fg-subtle" : "text-fg-faint")}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center gap-3 border-t border-line px-4 py-8">
          <IconTile tone="ok"><StatusDot tone="ok" /></IconTile>
          <div>
            <p className="text-[13px] font-medium text-fg">All clear</p>
            <p className="text-[12px] text-fg-muted">Nothing needs a decision today. Oil, repairs, papers, walk-arounds and drivers land here the moment they need someone.</p>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 border-t border-line px-6 py-10 text-center">
          <p className="text-[13px] font-medium text-fg">
            {needle ? `Nothing matches “${q.trim()}”` : `No ${DECISION_CATEGORY_LABELS[cat as DecisionCategory].toLowerCase()} items`}
          </p>
          <p className="max-w-sm text-[12px] text-fg-muted">{needle ? "Search looks at the unit, the driver and the issue." : "Other categories still have items."}</p>
          <button type="button" onClick={() => (needle ? search("") : choose("all"))} className={cn(buttonClass("secondary", "sm"), "mt-1")}>{needle ? "Clear search" : "Show all"}</button>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-line border-t border-line" aria-label={title}>
          {slice.map((d) => <DecisionRow key={d.key} d={d} canEdit={canEdit} />)}
        </ul>
      )}

      {shown.length > pageSize && (
        <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-[12px] text-fg-subtle">
          <span className="num">{current * pageSize + 1}–{Math.min(shown.length, (current + 1) * pageSize)} of {shown.length}</span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} className={buttonClass("ghost", "sm")}><ChevronLeft />Previous</button>
            <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className={buttonClass("ghost", "sm")}>Next<ChevronRight /></button>
          </span>
        </footer>
      )}
    </section>
  );
}

function DecisionRow({ d, canEdit }: { d: Decision; canEdit: boolean }) {
  const Icon = CATEGORY_ICON[d.category];
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-raised/60 md:grid-cols-[8.5rem_minmax(0,1fr)_5.5rem_auto] md:items-center">
      {/* Unit · driver */}
      <div className="min-w-0">
        {d.unit
          ? <Link href={d.unit.href} className={cn("block truncate font-medium text-fg hover:text-accent-text", d.unit.kind !== "driver" ? "num text-[14px]" : "text-[13px]")}>{d.unit.label}</Link>
          : <span className="block truncate text-[13px] text-fg-muted">Whole fleet</span>}
        {d.driver && d.unit?.kind !== "driver"
          ? <Link href={d.driver.href} className="block truncate text-[12px] text-fg-subtle hover:text-fg">{d.driver.name}</Link>
          : d.unit?.kind === "truck" || d.unit?.kind === "trailer" ? <span className="block truncate text-[12px] text-fg-faint">No driver</span> : null}
      </div>

      {/* Issue · detail */}
      <div className="col-span-2 row-start-2 flex min-w-0 items-start gap-2.5 md:col-span-1 md:row-start-auto md:items-center">
        <IconTile size="sm" tone={CATEGORY_HUE[d.category]} className="mt-px md:mt-0"><Icon aria-label={DECISION_CATEGORY_LABELS[d.category]} /></IconTile>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-fg">{d.issue}</p>
          <p className="truncate text-[12px] text-fg-subtle" title={d.detail}>{d.detail}</p>
        </div>
      </div>

      {/* Priority · age */}
      <div className="flex flex-col items-end gap-0.5 md:items-start">
        <Chip tone={DECISION_PRIORITY_TONE[d.priority]} title={DECISION_PRIORITY_HINTS[d.priority]}>{DECISION_PRIORITY_LABELS[d.priority]}</Chip>
        {d.age && <span className="num whitespace-nowrap text-[11px] text-fg-subtle">{d.age}</span>}
      </div>

      {/* The one action */}
      <div className="col-span-2 justify-self-start md:col-span-1 md:justify-self-end">
        {canEdit
          ? <LinkButton href={d.action.href} variant="secondary" size="sm">{d.action.label}</LinkButton>
          : <Link href={d.view.href} className="whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">{d.view.label} →</Link>}
      </div>
    </li>
  );
}
