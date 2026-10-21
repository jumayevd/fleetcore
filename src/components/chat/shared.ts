import { TIMEZONE } from "@/lib/constants";

/* Client-safe types and helpers shared by the chat page, the thread component, the action and the API. */

export type RoomKind = "company" | "team" | "load";
export type ParsedRoom = { kind: "company" } | { kind: "team"; teamId: string } | { kind: "load"; loadId: string };

export const COMPANY_ROOM = "company";
export const MAX_BODY = 2000;
export const POLL_MS = 4000;
export const PAGE_SIZE = 100;
/** Consecutive messages by the same author within this window are drawn as one group. */
const GROUP_MINUTES = 5;

/** "company" | "team:<id>" | "load:<id>" → structured room, or null when malformed. */
export function parseRoom(room: string | null | undefined): ParsedRoom | null {
  if (!room || room === COMPANY_ROOM) return { kind: "company" };
  const m = /^(team|load):([a-zA-Z0-9_-]{1,64})$/.exec(room);
  if (!m) return null;
  return m[1] === "team" ? { kind: "team", teamId: m[2] } : { kind: "load", loadId: m[2] };
}

export type ChatMessageDTO = {
  id: string;
  room: string;
  userId: string | null;
  userName: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Optimistic append awaiting the server. */
  pending?: boolean;
  /** The server rejected it (kept visible so the author can retry). */
  failed?: boolean;
};

export type RoomSummary = {
  /** The room key: "company", "team:<id>", "load:<id>". */
  id: string;
  kind: RoomKind;
  name: string;
  /** Route for loads, member count for teams, "Everyone" for the company room. */
  subtitle: string | null;
  /** Load status, for the tone dot. */
  status: string | null;
  /** Where the entity lives (load page), if the viewer can open it. */
  href: string | null;
  lastAt: string | null;
  lastPreview: string | null;
  lastBy: string | null;
};

export type ChatMe = { id: string; name: string; canViewLoads: boolean };

/** Shape returned by GET /api/chat. */
export type ChatApiResponse = { room: string; me: ChatMe; messages: ChatMessageDTO[]; hasMore: boolean; serverTime: string };

/* ------------------------------------------------------------------ */
/* Last-seen store (localStorage, per room)                            */
/* ------------------------------------------------------------------ */

const SEEN_KEY = "fleetops.chat.lastSeen";
const seenListeners = new Set<() => void>();

export function readSeenRaw(): string {
  try { return localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; }
}
export function parseSeen(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch { return {}; }
}
/** Record that the viewer has seen everything in `room` up to `at` (ISO). Never moves backwards. */
export function markSeen(room: string, at: string) {
  const cur = parseSeen(readSeenRaw());
  if (cur[room] && cur[room] >= at) return;
  cur[room] = at;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(cur)); } catch { /* storage unavailable */ }
  seenListeners.forEach((l) => l());
}
export function subscribeSeen(cb: () => void) {
  seenListeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === SEEN_KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { seenListeners.delete(cb); window.removeEventListener("storage", onStorage); };
}
export const isUnread = (room: RoomSummary, seen: Record<string, string>) =>
  Boolean(room.lastAt) && (!seen[room.id] || seen[room.id] < (room.lastAt as string));

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                 */
/* ------------------------------------------------------------------ */

export type MessageGroup = { key: string; userId: string | null; userName: string; at: string; items: ChatMessageDTO[] };
/** `key` is the React key (first message's timestamp); `day` the company-calendar day, "yyyy-MM-dd". */
export type DaySection = { key: string; day: string; label: string; groups: MessageGroup[] };

/*
 * Times and days are shown in company time (TIMEZONE), like every server-rendered date in the app. Formatting with a
 * fixed zone from numeric parts gives the same string during SSR and in any browser, so these labels hydrate without
 * mismatches whatever the server's or the viewer's zone. Relative labels take `today` (a day key) instead of reading
 * the clock: the chat page passes the server's day for the hydration render (see `useToday` in hooks.ts).
 */
const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Wall-clock parts of an instant in company time. */
function zoned(at: string | Date) {
  const p: Record<string, string> = {};
  for (const x of PARTS.formatToParts(typeof at === "string" ? new Date(at) : at)) p[x.type] = x.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute) };
}
const keyOf = (p: { y: number; mo: number; d: number }) => `${p.y}-${pad(p.mo)}-${pad(p.d)}`;

/** Company-calendar day of an instant, "yyyy-MM-dd". */
export const dayKeyOf = (at: string | Date) => keyOf(zoned(at));

/** Day separator: "Today", "Yesterday", "Friday 2 Oct" within the past week, otherwise "02 Oct 2026". */
function dayLabel(day: string, today: string) {
  const at = Date.parse(`${day}T00:00:00Z`);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - at) / DAY_MS);
  if (diff <= 0) return "Today"; // a clock running behind the server never shows a future day
  if (diff === 1) return "Yesterday";
  const [y, mo, d] = day.split("-").map(Number);
  return diff < 7 ? `${WEEKDAYS[new Date(at).getUTCDay()]} ${d} ${MONTHS[mo - 1]}` : `${pad(d)} ${MONTHS[mo - 1]} ${y}`;
}
/** "17:22" in company time. */
export const timeLabel = (iso: string) => { const p = zoned(iso); return `${pad(p.h)}:${pad(p.mi)}`; };
/** "05 Oct 2026, 17:22" in company time. */
export const fullTimeLabel = (iso: string) => { const p = zoned(iso); return `${pad(p.d)} ${MONTHS[p.mo - 1]} ${p.y}, ${pad(p.h)}:${pad(p.mi)}`; };
/** For the rooms column: the time when it is `today` (a day key), otherwise a short date. */
export function shortWhen(iso: string, today: string) {
  const p = zoned(iso);
  return keyOf(p) === today ? `${pad(p.h)}:${pad(p.mi)}` : `${pad(p.d)} ${MONTHS[p.mo - 1]}`;
}

/** Split into day sections (company calendar), each with author groups (same author, within 5 minutes). */
export function sectionize(messages: ChatMessageDTO[], today: string): DaySection[] {
  const out: DaySection[] = [];
  for (const m of messages) {
    const key = dayKeyOf(m.createdAt);
    let day = out[out.length - 1];
    if (!day || day.day !== key) {
      day = { key: m.createdAt, day: key, label: dayLabel(key, today), groups: [] };
      out.push(day);
    }
    const g = day.groups[day.groups.length - 1];
    const last = g?.items[g.items.length - 1];
    if (g && last && g.userId === m.userId && !last.failed && !m.failed && Math.abs(Date.parse(m.createdAt) - Date.parse(last.createdAt)) < GROUP_MINUTES * 60_000) {
      g.items.push(m);
    } else {
      day.groups.push({ key: m.id, userId: m.userId, userName: m.userName, at: m.createdAt, items: [m] });
    }
  }
  return out;
}

export const byCreatedAt = (a: ChatMessageDTO, b: ChatMessageDTO) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

export const firstName = (name: string | null | undefined) => (name ? name.split(/\s+/)[0] : "Someone");

/** One-line preview for the rooms column. */
export const previewOf = (body: string, max = 80) => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
