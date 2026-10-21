"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { Building2, Users } from "lucide-react";
import { STATUS_TONE, StatusDot, cn, inputClass } from "@/components/ui";
import { useToday } from "./hooks";
import { COMPANY_ROOM, firstName, isUnread, parseSeen, readSeenRaw, shortWhen, subscribeSeen, type RoomSummary } from "./shared";

/** Per-room "seen up to" timestamps from localStorage, live-updated when the thread marks a room read. */
function useSeen() {
  const raw = useSyncExternalStore(subscribeSeen, readSeenRaw, () => "");
  return useMemo(() => parseSeen(raw), [raw]);
}

const roomHref = (id: string) => (id === COMPANY_ROOM ? "/chat" : `/chat?room=${encodeURIComponent(id)}`);

function split(rooms: RoomSummary[]) {
  return {
    company: rooms.filter((r) => r.kind === "company"),
    teams: rooms.filter((r) => r.kind === "team"),
    loads: rooms.filter((r) => r.kind === "load"),
  };
}

/**
 * Desktop rooms column: Company · team room(s) · active load threads, with previews and unread dots.
 * `today` is the server's company day (hydration-stable times); `loadNote` explains a capped load list.
 */
export function RoomsColumn({ rooms, active, today: serverToday, loadNote, className }: {
  rooms: RoomSummary[]; active: string; today?: string; loadNote?: string | null; className?: string;
}) {
  const seen = useSeen();
  const today = useToday(serverToday);
  const { company, teams, loads } = split(rooms);
  const unreadLoads = loads.filter((r) => isUnread(r, seen)).length;
  const row = (r: RoomSummary) => <RoomRow key={r.id} r={r} active={r.id === active} unread={isUnread(r, seen)} today={today} />;
  return (
    <nav aria-label="Rooms" className={cn("w-64 shrink-0 flex-col border-r border-line", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <Section label="Company">{company.map(row)}</Section>
        {teams.length > 0 && <Section label={teams.length > 1 ? "Teams" : "My team"}>{teams.map(row)}</Section>}
        <Section label="Load threads" count={loads.length} unread={unreadLoads}>
          {loads.length === 0
            ? <p className="px-3 py-2 text-[11px] text-fg-subtle">No dispatched or in-transit loads right now.</p>
            : loads.map(row)}
          {loadNote && <p className="px-3 py-2 text-[11px] leading-4 text-fg-subtle">{loadNote}</p>}
        </Section>
      </div>
    </nav>
  );
}

function Section({ label, count, unread, children }: { label: string; count?: number; unread?: number; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
        <p className="eyebrow">{label}</p>
        {count != null && (
          <span className="num text-[10px] text-fg-subtle">
            {unread ? <span className="text-accent-text">{unread} unread · </span> : null}{count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function RoomRow({ r, active, unread, today }: { r: RoomSummary; active: boolean; unread: boolean; today: string }) {
  const Icon = r.kind === "team" ? Users : Building2;
  return (
    <Link href={roomHref(r.id)} aria-current={active ? "page" : undefined}
      className={cn("relative flex h-12 items-center gap-2.5 px-3 text-[13px] transition-colors", active ? "bg-raised" : "hover:bg-raised")}>
      {active && <span className="absolute left-0 top-2 h-8 w-0.5 rounded-r bg-accent" />}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sunken text-fg-subtle">
        {r.kind === "load" ? <StatusDot tone={STATUS_TONE[r.status ?? ""] ?? "neutral"} /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-fg", unread ? "font-semibold" : "font-medium", r.kind === "load" && "num")}>{r.name}</span>
          {r.lastAt && <span className="num shrink-0 text-[10px] text-fg-subtle">{shortWhen(r.lastAt, today)}</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          {unread && <span role="img" aria-label="Unread" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
          <span className={cn("truncate", unread && "text-fg-muted")}>
            {r.lastPreview ? <><span className="text-fg-muted">{firstName(r.lastBy)}:</span> {r.lastPreview}</> : r.subtitle}
          </span>
        </span>
      </span>
    </Link>
  );
}

/** Mobile: the rooms column collapses into a select above the thread. */
export function RoomSelect({ rooms, active, className }: { rooms: RoomSummary[]; active: string; className?: string }) {
  const router = useRouter();
  const seen = useSeen();
  const { company, teams, loads } = split(rooms);
  const label = (r: RoomSummary) => `${isUnread(r, seen) ? "• " : ""}${r.name}${r.kind === "load" && r.subtitle ? ` — ${r.subtitle}` : ""}`;
  return (
    <div className={cn("border-b border-line p-2", className)}>
      <select aria-label="Room" value={active} onChange={(e) => router.push(roomHref(e.target.value))} className={cn(inputClass, "pr-7")}>
        <optgroup label="Company">{company.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}</optgroup>
        {teams.length > 0 && <optgroup label={teams.length > 1 ? "Teams" : "My team"}>{teams.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}</optgroup>}
        {loads.length > 0 && <optgroup label="Active load threads">{loads.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}</optgroup>}
        {!rooms.some((r) => r.id === active) && <option value={active}>{active}</option>}
      </select>
    </div>
  );
}
