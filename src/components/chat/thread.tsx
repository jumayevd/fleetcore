"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowDown, Building2, ExternalLink, Package, SendHorizontal, Users } from "lucide-react";
import { sendMessage, type SendState } from "@/app/actions/chat";
import { FormMessage } from "@/components/forms";
import { Avatar, Badge, Button, EmptyState, Kbd, LiveDot, cn } from "@/components/ui";
import { LOAD_STATUS_LABELS, type LoadStatus } from "@/lib/constants";
import { useHydrated, useToday } from "./hooks";
import { Linkified } from "./linkify";
import {
  MAX_BODY, POLL_MS, byCreatedAt, fullTimeLabel, markSeen, parseRoom, parseSeen, readSeenRaw, sectionize, timeLabel,
  type ChatApiResponse, type ChatMe, type ChatMessageDTO, type MessageGroup, type RoomSummary,
} from "./shared";

const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  company: { title: "No messages yet", description: "Say hello — everyone in the company sees this room." },
  team: { title: "Nothing here yet", description: "Use this room for team-only coordination: swaps, cover, hand-offs." },
  load: { title: "Start the thread", description: "Dispatch and the driver see it here and from the load page. Mention a load as LD-10102 to link it." },
};
/** Drivers get LD-numbers as plain text, so their copy doesn't promise links. */
const DRIVER_LOAD_EMPTY = { title: "Start the thread", description: "Dispatch sees this thread and your messages from the load page." };

/**
 * A chat room: day separators, messages grouped by author, auto-linked bodies, a composer (Enter sends,
 * Shift+Enter breaks the line), optimistic append and polling every 4 s via /api/chat.
 *
 * Standalone use: `<ChatThread room="load:<id>" compact />` fetches its own history and viewer identity.
 * The chat page passes `initial`, `me`, `meta` and `today` so the first paint comes from the server.
 */
export function ChatThread({ room, meta, initial, hasMore: hasMoreInitial = false, me: meProp, notice, onLatest, today: serverToday, compact = false, className }: {
  room: string;
  /** Header details (name, route, status). Omitted in compact / embedded mode. */
  meta?: RoomSummary | null;
  /** Server-rendered first page, oldest first. When omitted the thread loads it from the API. */
  initial?: ChatMessageDTO[];
  hasMore?: boolean;
  me?: ChatMe;
  /** One-line notice above the messages (e.g. "showing the company room instead"). */
  notice?: string | null;
  /** Called with the newest message whenever one arrives (sent or polled) — keeps room previews fresh. */
  onLatest?: (m: ChatMessageDTO) => void;
  /** The server's company-calendar day ("yyyy-MM-dd") — required with `initial` so day labels hydrate unchanged. */
  today?: string;
  compact?: boolean;
  className?: string;
}) {
  const selfLoad = initial === undefined;
  const [messages, setMessages] = useState<ChatMessageDTO[]>(initial ?? []);
  const [meState, setMeState] = useState<ChatMe | null>(null);
  const me = meProp ?? meState;
  const [loading, setLoading] = useState(selfLoad);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(hasMoreInitial);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** True while the viewer is at (or near) the bottom — new messages then auto-scroll. */
  const stickRef = useRef(true);
  const messagesRef = useRef(messages);
  /** scrollHeight before older messages were prepended, so the viewport stays put. */
  const prependRef = useRef<number | null>(null);
  const hydrated = useHydrated();
  // What the viewer had seen when this room opened — the "New" divider is drawn after it.
  const [seenAtOpen] = useState(() => parseSeen(readSeenRaw())[room] ?? null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  /** Newest server-confirmed timestamp (ISO) — the polling cursor. */
  const cursor = useCallback(() => {
    const list = messagesRef.current;
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].pending && !list[i].failed) return list[i].createdAt;
    return null;
  }, []);
  const lastConfirmedAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].pending && !messages[i].failed) return messages[i].createdAt;
    return null;
  }, [messages]);

  const fetchPage = useCallback(async (params: Record<string, string>): Promise<ChatApiResponse | null> => {
    const p = new URLSearchParams({ room, ...params });
    const r = await fetch(`/api/chat?${p}`, { cache: "no-store" });
    if (r.status === 401 || r.status === 403) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setBlocked(j.error ?? "You don't have access to this room");
      return null;
    }
    if (!r.ok) return null;
    return (await r.json()) as ChatApiResponse;
  }, [room]);

  // First page when embedded without server data.
  useEffect(() => {
    if (!selfLoad) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPage({});
        if (cancelled) return;
        if (data) { setMeState(data.me); setMessages(data.messages); setHasMore(data.hasMore); }
      } catch { /* offline — the next poll retries */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selfLoad, fetchPage]);

  const poll = useCallback(async () => {
    try {
      const after = cursor();
      const data = await fetchPage(after ? { after } : {});
      if (!data) return;
      if (!meProp) setMeState(data.me);
      const known = new Set(messagesRef.current.map((m) => m.id));
      const add = data.messages.filter((m) => !known.has(m.id));
      if (!add.length) return;
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        let next = prev;
        for (const m of add) {
          if (ids.has(m.id)) continue;
          // Our own optimistic copy may still be waiting for the action — swap it rather than duplicating.
          const i = next.findIndex((t) => t.pending && t.userId === m.userId && t.body === m.body);
          if (i >= 0) { next = next.slice(); next[i] = m; } else next = [...next, m];
        }
        return next.sort(byCreatedAt);
      });
      onLatest?.(add[add.length - 1]);
      const myId = (meProp ?? data.me).id;
      const others = add.filter((m) => m.userId !== myId).length;
      if (!stickRef.current && others) setNewBelow((n) => n + others);
    } catch { /* offline — keep what we have */ }
  }, [cursor, fetchPage, meProp, onLatest]);

  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void poll(); }, POLL_MS);
    const onVisible = () => {
      if (document.hidden) return;
      void poll();
      const c = cursor();
      if (c) markSeen(room, c);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [poll, cursor, room]);

  // Everything rendered counts as seen while the tab is visible.
  useEffect(() => { if (lastConfirmedAt && !document.hidden) markSeen(room, lastConfirmedAt); }, [lastConfirmedAt, room]);

  // Keep the viewport pinned to the bottom, or in place after loading older messages.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prependRef.current != null) { el.scrollTop += el.scrollHeight - prependRef.current; prependRef.current = null; return; }
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = atBottom;
    if (atBottom && newBelow) setNewBelow(0);
  };
  const jumpToBottom = () => {
    const el = listRef.current;
    stickRef.current = true;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewBelow(0);
  };

  const loadEarlier = async () => {
    const first = messagesRef.current.find((m) => !m.pending && !m.failed);
    if (!first || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage({ before: first.createdAt });
      if (data) {
        prependRef.current = listRef.current?.scrollHeight ?? null;
        stickRef.current = false;
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...data.messages.filter((m) => !ids.has(m.id)), ...prev].sort(byCreatedAt);
        });
        setHasMore(data.hasMore);
      }
    } catch { /* leave the button for another try */ } finally { setLoadingMore(false); }
  };

  const submit = useCallback((body: string) => {
    if (!me) return;
    const temp: ChatMessageDTO = {
      id: `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      room, userId: me.id, userName: me.name, body, createdAt: new Date().toISOString(), pending: true,
    };
    stickRef.current = true;
    setSendError(null);
    setMessages((prev) => [...prev, temp]);
    const fd = new FormData();
    fd.set("body", body);
    startTransition(async () => {
      let res: SendState;
      try { res = await sendMessage(room, undefined, fd); } catch { res = { error: "Couldn't reach the server — check the connection and retry" }; }
      if (res?.message) {
        const real = res.message;
        setMessages((prev) => (prev.some((m) => m.id === real.id) ? prev.filter((m) => m.id !== temp.id) : prev.map((m) => (m.id === temp.id ? real : m))));
        onLatest?.(real);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
        setSendError(res?.error ?? "Couldn't send — try again");
      }
    });
  }, [me, room, onLatest]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    if (body.length > MAX_BODY) { setSendError(`Keep messages under ${MAX_BODY} characters`); return; }
    setDraft("");
    if (taRef.current) taRef.current.style.height = "auto";
    submit(body);
  };
  const retry = (m: ChatMessageDTO) => { setMessages((prev) => prev.filter((x) => x.id !== m.id)); setSendError(null); submit(m.body); };
  const discard = (m: ChatMessageDTO) => { setMessages((prev) => prev.filter((x) => x.id !== m.id)); setSendError(null); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };
  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const today = useToday(serverToday);
  const sections = useMemo(() => sectionize(messages, today), [messages, today]);
  const firstUnreadId = useMemo(() => {
    if (!hydrated || !seenAtOpen) return null;
    return messages.find((m) => m.createdAt > seenAtOpen && m.userId !== me?.id && !m.pending && !m.failed)?.id ?? null;
  }, [hydrated, seenAtOpen, messages, me?.id]);

  const kind = parseRoom(room)?.kind ?? "company";
  const Icon = kind === "load" ? Package : kind === "team" ? Users : Building2;
  const status = meta?.status && meta.status in LOAD_STATUS_LABELS ? (meta.status as LoadStatus) : null;
  const placeholder = kind === "company" ? "Message everyone in the company" : kind === "team" && meta ? `Message ${meta.name}` : kind === "load" && meta ? `Message the ${meta.name} thread` : "Write a message";
  const loadLinks = me?.canViewLoads ?? true;
  const empty = kind === "load" && !loadLinks ? DRIVER_LOAD_EMPTY : EMPTY_COPY[kind];
  const over = draft.length > MAX_BODY;

  return (
    <section className={cn("flex min-h-0 flex-col", compact ? "h-[360px] rounded-lg border border-line bg-surface" : "flex-1", className)} aria-label={meta ? `${meta.name} chat` : "Chat"}>
      {!compact && meta && (
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-fg-subtle" />
            <h2 className={cn("truncate text-[13px] font-semibold text-fg", kind === "load" && "num")}>{meta.name}</h2>
            {status && <Badge value={status} label={LOAD_STATUS_LABELS[status]} dot />}
            {meta.subtitle && <span className="hidden truncate text-[12px] text-fg-muted sm:inline">{meta.subtitle}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {meta.href && kind === "load" && (
              <Link href={meta.href} className="inline-flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg">
                <ExternalLink className="h-3.5 w-3.5" />Open load
              </Link>
            )}
            <LiveDot label="Live" className="hidden sm:inline-flex" />
          </div>
        </header>
      )}
      {notice && <p className="shrink-0 border-b border-line bg-warn-soft px-4 py-1.5 text-[12px] text-warn">{notice}</p>}

      <div className="relative min-h-0 flex-1">
        {/* Focusable so keyboard users can scroll a thread that has no links to tab through. */}
        <div ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages" tabIndex={0}
          className={cn("h-full overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40", compact ? "py-1" : "py-2")}>
          {blocked ? (
            <EmptyState title="No access to this room" description={blocked} />
          ) : loading ? (
            <p className="px-4 py-10 text-center text-[12px] text-fg-muted">Loading messages…</p>
          ) : messages.length === 0 ? (
            <EmptyState title={empty.title} description={empty.description} />
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center pb-1">
                  <Button variant="ghost" size="sm" onClick={loadEarlier} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load earlier messages"}</Button>
                </div>
              )}
              {sections.map((day) => (
                <div key={day.key}>
                  <div className="relative my-2 flex items-center justify-center px-4" aria-hidden>
                    <span className="absolute inset-x-4 top-1/2 border-t border-line" />
                    <span className="eyebrow relative bg-surface px-2">{day.label}</span>
                  </div>
                  {day.groups.map((g) => (
                    <div key={g.key}>
                      {firstUnreadId && g.items.some((i) => i.id === firstUnreadId) && (
                        <div className="my-1 flex items-center gap-2 px-4" role="separator" aria-label="New messages">
                          <span className="flex-1 border-t border-accent" />
                          <span className="text-[11px] font-medium text-accent-text">New</span>
                        </div>
                      )}
                      <Group g={g} own={g.userId != null && g.userId === me?.id} loadLinks={loadLinks} compact={compact} onRetry={retry} onDiscard={discard} />
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
        {newBelow > 0 && (
          <button type="button" onClick={jumpToBottom}
            className="absolute inset-x-0 bottom-3 mx-auto inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-medium text-on-primary shadow-float hover:bg-primary-hover">
            <ArrowDown className="h-3.5 w-3.5" /><span className="num">{newBelow}</span> new {newBelow === 1 ? "message" : "messages"}
          </button>
        )}
      </div>

      <div className={cn("shrink-0 border-t border-line", compact ? "p-2" : "p-3")}>
        {sendError && <FormMessage tone="error" className="mb-2">{sendError}</FormMessage>}
        <div className={cn("flex items-end gap-1.5 rounded-md border bg-surface pl-1 pr-1 focus-within:ring-2 focus-within:ring-accent/30", over ? "border-danger" : "border-line focus-within:border-accent")}>
          <textarea
            ref={taRef} value={draft} onChange={onChange} onKeyDown={onKeyDown} rows={1} disabled={Boolean(blocked) || !me}
            placeholder={blocked ? "You can't post here" : placeholder} aria-label="Message"
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-5 text-fg outline-none placeholder:text-fg-faint disabled:opacity-50"
          />
          <Button type="button" size="sm" onClick={send} disabled={!draft.trim() || over || Boolean(blocked) || !me} aria-label="Send" title="Send (Enter)" className="mb-0.5 w-7 px-0">
            <SendHorizontal />
          </Button>
        </div>
        {!compact && (
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
            <span className="hidden sm:inline">
              <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> for a new line · {loadLinks ? "LD-numbers and links become clickable" : "links become clickable"}
            </span>
            {draft.length > MAX_BODY - 200 && <span className={cn("num ml-auto", over && "text-danger")}>{draft.length} / {MAX_BODY}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function Group({ g, own, loadLinks, compact, onRetry, onDiscard }: {
  g: MessageGroup; own: boolean; loadLinks: boolean; compact: boolean;
  onRetry: (m: ChatMessageDTO) => void; onDiscard: (m: ChatMessageDTO) => void;
}) {
  return (
    <div className={cn("flex gap-2.5 px-4 hover:bg-raised", compact ? "py-1" : "py-1.5")}>
      <Avatar name={g.userName} size={compact ? 24 : 28} className={cn("mt-0.5", own && "bg-accent-soft text-accent-text")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-fg">{g.userName}</span>
          {own && <span className="text-[10px] text-fg-subtle">you</span>}
          <time dateTime={g.at} title={fullTimeLabel(g.at)} className="num shrink-0 text-[11px] text-fg-subtle">{timeLabel(g.at)}</time>
        </div>
        {g.items.map((m) => (
          <div key={m.id} title={m.pending ? "Sending…" : fullTimeLabel(m.createdAt)} className={cn("text-[13px] leading-5 text-fg", m.pending && "opacity-60", m.failed && "text-danger")}>
            <p className="whitespace-pre-wrap break-words"><Linkified text={m.body} loadLinks={loadLinks} /></p>
            {m.failed && (
              <p className="mt-0.5 flex items-center gap-2 text-[11px]">
                <span>Not sent</span>
                <button type="button" onClick={() => onRetry(m)} className="font-medium underline underline-offset-2 hover:text-fg">Retry</button>
                <button type="button" onClick={() => onDiscard(m)} className="text-fg-subtle underline underline-offset-2 hover:text-fg">Discard</button>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
